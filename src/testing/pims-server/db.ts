import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import postgres from "postgres";

export type SqlClient = postgres.Sql;

export interface DbConfigOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  max?: number;
  idle_timeout?: number;
  connect_timeout?: number;
}

export function createSqlClient(
  connectionStringOrOptions?: string | DbConfigOptions,
): SqlClient {
  if (typeof connectionStringOrOptions === "string") {
    return postgres(connectionStringOrOptions);
  }
  if (connectionStringOrOptions) {
    return postgres({
      host: connectionStringOrOptions.host ?? "localhost",
      port: connectionStringOrOptions.port ?? 5432,
      user: connectionStringOrOptions.user ?? "postgres",
      password: connectionStringOrOptions.password ?? "postgres",
      database: connectionStringOrOptions.database ?? "postgres",
      max: connectionStringOrOptions.max ?? 10,
      idle_timeout: connectionStringOrOptions.idle_timeout ?? 10,
      connect_timeout: connectionStringOrOptions.connect_timeout ?? 30,
    });
  }
  return postgres();
}

/**
 * Initializes the database using data/gestitel_base_de_datos.sql,
 * creates the `unsa` schema cloned from `demo`, and seeds required test records.
 */
export async function initDatabase(sql: SqlClient): Promise<void> {
  const sqlDumpPath = path.resolve(
    process.cwd(),
    "data/gestitel_base_de_datos.sql",
  );
  const fallbackPath =
    "/home/cricro/temp/pims-final/data/gestitel_base_de_datos.sql";
  const finalPath = fs.existsSync(sqlDumpPath) ? sqlDumpPath : fallbackPath;

  if (!fs.existsSync(finalPath)) {
    throw new Error(`PIMS SQL dump not found at ${finalPath}`);
  }

  const rawSql = fs.readFileSync(finalPath, "utf-8");
  const lines = rawSql.split("\n");

  let sqlBuffer: string[] = [];
  let inCopy = false;
  let copyCommand = "";
  let copyRows: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine === undefined) {
      continue;
    }
    const trimmed = rawLine.trim();

    // Ignore psql meta-commands (except \. which terminates COPY)
    if (
      trimmed.startsWith("\\set") ||
      trimmed.startsWith("\\restrict") ||
      trimmed.startsWith("\\unrestrict")
    ) {
      continue;
    }

    if (!inCopy) {
      if (trimmed.startsWith("COPY ") && trimmed.endsWith("FROM stdin;")) {
        // Flush pending SQL statements first
        if (sqlBuffer.length > 0) {
          const stmt = sqlBuffer.join("\n").trim();
          if (stmt.length > 0) {
            await sql.unsafe(stmt);
          }
          sqlBuffer = [];
        }
        inCopy = true;
        copyCommand = trimmed;
        copyRows = [];
      } else {
        sqlBuffer.push(rawLine);
      }
    } else {
      if (trimmed === "\\.") {
        // End of COPY block: stream collected rows into Postgres
        inCopy = false;
        if (copyRows.length > 0) {
          const tsvData = `${copyRows.join("\n")}\n`;
          const sourceStream = Readable.from([tsvData]);
          const writableStream = await sql.unsafe(copyCommand).writable();
          await pipeline(sourceStream, writableStream);
        }
        copyCommand = "";
        copyRows = [];
      } else {
        copyRows.push(rawLine);
      }
    }
  }

  // Flush any trailing SQL statements
  if (sqlBuffer.length > 0) {
    const stmt = sqlBuffer.join("\n").trim();
    if (stmt.length > 0) {
      await sql.unsafe(stmt);
    }
  }

  // Ensure unsa schema exists and clone structure from demo schema
  await sql`CREATE SCHEMA IF NOT EXISTS unsa`;

  // Clone all demo tables into unsa
  const demoTables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'demo' AND table_type = 'BASE TABLE'
  `;

  for (const row of demoTables) {
    const tbl = row.table_name;
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS unsa."${tbl}" (LIKE demo."${tbl}" INCLUDING ALL)`,
    );
    await sql.unsafe(
      `INSERT INTO unsa."${tbl}" SELECT * FROM demo."${tbl}" ON CONFLICT DO NOTHING`,
    );
  }

  // Set default search path
  await sql`SET search_path TO unsa, demo, public`;

  // Seed default test user in auth_user (both demo and unsa schemas)
  for (const schema of ["demo", "unsa"]) {
    await sql.unsafe(`
      INSERT INTO ${schema}.auth_user (
        id, password, last_login, is_superuser, username, first_name, last_name, email, is_staff, is_active, date_joined
      ) VALUES (
        1, 'password123', NOW(), true, 'admin', 'Admin', 'UNSA', 'admin@unsa.pe', true, true, NOW()
      ) ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        password = EXCLUDED.password,
        email = EXCLUDED.email,
        is_active = EXCLUDED.is_active,
        is_staff = EXCLUDED.is_staff,
        is_superuser = EXCLUDED.is_superuser
    `);

    // Ensure core_userprofile exists for user 1
    await sql.unsafe(`
      INSERT INTO ${schema}.core_userprofile (
        id, area, "position", user_id, is_platform_admin, must_change_password
      ) VALUES (
        1, 'Seguridad de la Información', 'Administrador', 1, true, false
      ) ON CONFLICT (id) DO UPDATE SET
        is_platform_admin = EXCLUDED.is_platform_admin,
        must_change_password = EXCLUDED.must_change_password
    `);

    // Ensure active risk period exists in core_riskperiod
    await sql.unsafe(`
      INSERT INTO ${schema}.core_riskperiod (
        id, created_at, updated_at, is_deleted, deleted_at, name, start_date, end_date, status, is_active, description, closed_at, snapshot_matrix_name, snapshot_dimension, snapshot_risk_ranges, created_by_id, deleted_by_id, updated_by_id
      ) VALUES (
        1, NOW(), NOW(), false, NULL, 'Periodo 2026', '2026-01-01', '2026-12-31', 'O', true, 'Periodo activo para pruebas', NULL, NULL, NULL, '[]'::jsonb, 1, NULL, 1
      ) ON CONFLICT (id) DO UPDATE SET
        is_active = true,
        status = 'O'
    `);

    // Ensure at least 1 asset exists in core_asset
    await sql.unsafe(`
      INSERT INTO ${schema}.core_asset (
        id, created_at, updated_at, is_deleted, deleted_at, code, name, description, owner, custodians, location, is_data_asset, category, classification, usage_frequency, confidentiality, integrity, availability, weight_confidentiality, weight_integrity, weight_availability, purpose, data_categories, role, pii_controls, legal_basis, purpose_detail, collection_origin, collection_procedure, data_usage, retention_period, disposal_method, third_party_transfer, national_transfers, cross_border_flow, international_flows, times_compromised, processes_affected, loss_range, relevance, created_by_id, deleted_by_id, updated_by_id, process_id, asset_value, cid_method, legacy_code
      ) VALUES (
        1, NOW(), NOW(), false, NULL, 'AST-001', 'Servidor Principal', 'Servidor principal de base de datos y procesamiento', 'TI UNSA', 'Equipo de TI', 'Centro de Cómputo', true, 'HARDWARE', 'CONFIDENCIAL', 'DIARIO', 'A', 'A', 'A', 1.00, 1.00, 1.00, 'Almacenamiento de datos institucionales', '["identificativos", "contacto"]'::jsonb, 'C', '["cifrado_datos", "control_acceso"]'::jsonb, 'Cumplimiento legal', 'Gestión institucional', 'Directo', 'Registro del sistema', 'Operaciones institucionales', '5 años', 'Destrucción segura', false, '[]'::jsonb, false, '[]'::jsonb, 0, '1', '1', 'ALTO', 1, NULL, 1, NULL, 5.00, 'M', 'AST-001-LEG'
      ) ON CONFLICT (id) DO UPDATE SET
        is_deleted = false,
        relevance = 'ALTO'
    `);

    // Reset sequences to prevent duplicate key errors
    await sql.unsafe(`
      SELECT setval('${schema}.auth_user_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.auth_user), 1));
      SELECT setval('${schema}.core_userprofile_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.core_userprofile), 1));
      SELECT setval('${schema}.core_riskperiod_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.core_riskperiod), 1));
      SELECT setval('${schema}.core_asset_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.core_asset), 1));
      SELECT setval('${schema}.core_incident_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.core_incident), 1));
      SELECT setval('${schema}.core_incidenthistory_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.core_incidenthistory), 1));
      SELECT setval('${schema}.core_incidentaction_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.core_incidentaction), 1));
      SELECT setval('${schema}.core_incidentattachment_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.core_incidentattachment), 1));
      SELECT setval('${schema}.core_incidentrecipient_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.core_incidentrecipient), 1));
      SELECT setval('${schema}.core_audit_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.core_audit), 1));
      SELECT setval('${schema}.core_auditfinding_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.core_auditfinding), 1));
      SELECT setval('${schema}.core_auditactionplan_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.core_auditactionplan), 1));
      SELECT setval('${schema}.core_riskevaluation_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.core_riskevaluation), 1));
      SELECT setval('${schema}.core_riskevaluationasset_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${schema}.core_riskevaluationasset), 1));
    `);
  }

  // Ensure public customer client exists
  await sql`
    INSERT INTO public.customer_client (
      id, schema_name, name, tax_id, contact_email, is_active, created_at, updated_at, document_limit, compliance_standard
    ) VALUES (
      3, 'unsa', 'UNSA', '20123456789', 'admin@unsa.pe', true, NOW(), NOW(), NULL, 'ISO27001_27701_INT'
    ) ON CONFLICT (id) DO UPDATE SET
      schema_name = 'unsa',
      name = 'UNSA',
      is_active = true
  `;
}
