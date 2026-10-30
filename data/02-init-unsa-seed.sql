-- =============================================================================
-- 02-init-unsa-seed.sql
-- Initializes the 'unsa' schema cloned from 'demo' and seeds required test entities.
-- Executed automatically by postgres entrypoint after 01-gestitel.sql
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS unsa;

DO $$
DECLARE
    tbl record;
BEGIN
    FOR tbl IN
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'demo' AND table_type = 'BASE TABLE'
    LOOP
        EXECUTE format('CREATE TABLE IF NOT EXISTS unsa.%I (LIKE demo.%I INCLUDING ALL)', tbl.table_name, tbl.table_name);
        EXECUTE format('INSERT INTO unsa.%I SELECT * FROM demo.%I ON CONFLICT DO NOTHING', tbl.table_name, tbl.table_name);
    END LOOP;
END;
$$;

-- Seed default test user in auth_user (both demo and unsa schemas)
INSERT INTO demo.auth_user (
  id, password, last_login, is_superuser, username, first_name, last_name, email, is_staff, is_active, date_joined
) VALUES (
  1, 'password123', NOW(), true, 'admin', 'Admin', 'UNSA', 'admin@unsa.pe', true, true, NOW()
) ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  password = EXCLUDED.password,
  email = EXCLUDED.email,
  is_active = EXCLUDED.is_active,
  is_staff = EXCLUDED.is_staff,
  is_superuser = EXCLUDED.is_superuser;

INSERT INTO unsa.auth_user (
  id, password, last_login, is_superuser, username, first_name, last_name, email, is_staff, is_active, date_joined
) VALUES (
  1, 'password123', NOW(), true, 'admin', 'Admin', 'UNSA', 'admin@unsa.pe', true, true, NOW()
) ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  password = EXCLUDED.password,
  email = EXCLUDED.email,
  is_active = EXCLUDED.is_active,
  is_staff = EXCLUDED.is_staff,
  is_superuser = EXCLUDED.is_superuser;

-- Ensure core_userprofile exists for user 1
INSERT INTO demo.core_userprofile (
  id, area, "position", user_id, is_platform_admin, must_change_password
) VALUES (
  1, 'Seguridad de la Información', 'Administrador', 1, true, false
) ON CONFLICT (id) DO UPDATE SET
  is_platform_admin = EXCLUDED.is_platform_admin,
  must_change_password = EXCLUDED.must_change_password;

INSERT INTO unsa.core_userprofile (
  id, area, "position", user_id, is_platform_admin, must_change_password
) VALUES (
  1, 'Seguridad de la Información', 'Administrador', 1, true, false
) ON CONFLICT (id) DO UPDATE SET
  is_platform_admin = EXCLUDED.is_platform_admin,
  must_change_password = EXCLUDED.must_change_password;

-- Ensure active risk period exists in core_riskperiod
INSERT INTO demo.core_riskperiod (
  id, created_at, updated_at, is_deleted, deleted_at, name, start_date, end_date, status, is_active, description, closed_at, snapshot_matrix_name, snapshot_dimension, snapshot_risk_ranges, created_by_id, deleted_by_id, updated_by_id
) VALUES (
  1, NOW(), NOW(), false, NULL, 'Periodo 2026', '2026-01-01', '2026-12-31', 'O', true, 'Periodo activo para pruebas', NULL, NULL, NULL, '[]'::jsonb, 1, NULL, 1
) ON CONFLICT (id) DO UPDATE SET
  is_active = true,
  status = 'O';

INSERT INTO unsa.core_riskperiod (
  id, created_at, updated_at, is_deleted, deleted_at, name, start_date, end_date, status, is_active, description, closed_at, snapshot_matrix_name, snapshot_dimension, snapshot_risk_ranges, created_by_id, deleted_by_id, updated_by_id
) VALUES (
  1, NOW(), NOW(), false, NULL, 'Periodo 2026', '2026-01-01', '2026-12-31', 'O', true, 'Periodo activo para pruebas', NULL, NULL, NULL, '[]'::jsonb, 1, NULL, 1
) ON CONFLICT (id) DO UPDATE SET
  is_active = true,
  status = 'O';

-- Ensure at least 1 asset exists in core_asset
INSERT INTO demo.core_asset (
  id, created_at, updated_at, is_deleted, deleted_at, code, name, description, owner, custodians, location, is_data_asset, category, classification, usage_frequency, confidentiality, integrity, availability, weight_confidentiality, weight_integrity, weight_availability, purpose, data_categories, role, pii_controls, legal_basis, purpose_detail, collection_origin, collection_procedure, data_usage, retention_period, disposal_method, third_party_transfer, national_transfers, cross_border_flow, international_flows, times_compromised, processes_affected, loss_range, relevance, created_by_id, deleted_by_id, updated_by_id, process_id, asset_value, cid_method, legacy_code
) VALUES (
  1, NOW(), NOW(), false, NULL, 'AST-001', 'Servidor Principal', 'Servidor principal de base de datos y procesamiento', 'TI UNSA', 'Equipo de TI', 'Centro de Cómputo', true, 'HARDWARE', 'CONFIDENCIAL', 'DIARIO', 'A', 'A', 'A', 1.00, 1.00, 1.00, 'Almacenamiento de datos institucionales', '["identificativos", "contacto"]'::jsonb, 'C', '["cifrado_datos", "control_acceso"]'::jsonb, 'Cumplimiento legal', 'Gestión institucional', 'Directo', 'Registro del sistema', 'Operaciones institucionales', '5 años', 'Destrucción segura', false, '[]'::jsonb, false, '[]'::jsonb, 0, '1', '1', 'ALTO', 1, NULL, 1, NULL, 5.00, 'M', 'AST-001-LEG'
) ON CONFLICT (id) DO UPDATE SET
  is_deleted = false,
  relevance = 'ALTO';

INSERT INTO unsa.core_asset (
  id, created_at, updated_at, is_deleted, deleted_at, code, name, description, owner, custodians, location, is_data_asset, category, classification, usage_frequency, confidentiality, integrity, availability, weight_confidentiality, weight_integrity, weight_availability, purpose, data_categories, role, pii_controls, legal_basis, purpose_detail, collection_origin, collection_procedure, data_usage, retention_period, disposal_method, third_party_transfer, national_transfers, cross_border_flow, international_flows, times_compromised, processes_affected, loss_range, relevance, created_by_id, deleted_by_id, updated_by_id, process_id, asset_value, cid_method, legacy_code
) VALUES (
  1, NOW(), NOW(), false, NULL, 'AST-001', 'Servidor Principal', 'Servidor principal de base de datos y procesamiento', 'TI UNSA', 'Equipo de TI', 'Centro de Cómputo', true, 'HARDWARE', 'CONFIDENCIAL', 'DIARIO', 'A', 'A', 'A', 1.00, 1.00, 1.00, 'Almacenamiento de datos institucionales', '["identificativos", "contacto"]'::jsonb, 'C', '["cifrado_datos", "control_acceso"]'::jsonb, 'Cumplimiento legal', 'Gestión institucional', 'Directo', 'Registro del sistema', 'Operaciones institucionales', '5 años', 'Destrucción segura', false, '[]'::jsonb, false, '[]'::jsonb, 0, '1', '1', 'ALTO', 1, NULL, 1, NULL, 5.00, 'M', 'AST-001-LEG'
) ON CONFLICT (id) DO UPDATE SET
  is_deleted = false,
  relevance = 'ALTO';

-- Reset sequences to prevent duplicate key errors
DO $$
DECLARE
  s text;
BEGIN
  FOR s IN SELECT unnest(ARRAY['demo', 'unsa']) LOOP
    EXECUTE format('SELECT setval(''%s.auth_user_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.auth_user), 1))', s, s);
    EXECUTE format('SELECT setval(''%s.core_userprofile_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.core_userprofile), 1))', s, s);
    EXECUTE format('SELECT setval(''%s.core_riskperiod_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.core_riskperiod), 1))', s, s);
    EXECUTE format('SELECT setval(''%s.core_asset_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.core_asset), 1))', s, s);
    EXECUTE format('SELECT setval(''%s.core_incident_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.core_incident), 1))', s, s);
    EXECUTE format('SELECT setval(''%s.core_incidenthistory_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.core_incidenthistory), 1))', s, s);
    EXECUTE format('SELECT setval(''%s.core_incidentaction_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.core_incidentaction), 1))', s, s);
    EXECUTE format('SELECT setval(''%s.core_incidentattachment_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.core_incidentattachment), 1))', s, s);
    EXECUTE format('SELECT setval(''%s.core_incidentrecipient_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.core_incidentrecipient), 1))', s, s);
    EXECUTE format('SELECT setval(''%s.core_audit_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.core_audit), 1))', s, s);
    EXECUTE format('SELECT setval(''%s.core_auditfinding_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.core_auditfinding), 1))', s, s);
    EXECUTE format('SELECT setval(''%s.core_auditactionplan_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.core_auditactionplan), 1))', s, s);
    EXECUTE format('SELECT setval(''%s.core_riskevaluation_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.core_riskevaluation), 1))', s, s);
    EXECUTE format('SELECT setval(''%s.core_riskevaluationasset_id_seq'', GREATEST((SELECT COALESCE(MAX(id), 1) FROM %s.core_riskevaluationasset), 1))', s, s);
  END LOOP;
END;
$$;

-- Ensure public customer client exists
INSERT INTO public.customer_client (
  id, schema_name, name, tax_id, contact_email, is_active, created_at, updated_at, document_limit, compliance_standard
) VALUES (
  3, 'unsa', 'UNSA', '20123456789', 'admin@unsa.pe', true, NOW(), NOW(), NULL, 'ISO27001_27701_INT'
) ON CONFLICT (id) DO UPDATE SET
  schema_name = 'unsa',
  name = 'UNSA',
  is_active = true;
