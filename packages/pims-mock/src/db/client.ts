import * as schema from "@pims/pims-mock/db/schema.ts";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type SqlClient = postgres.Sql;
export type MockDb = ReturnType<typeof drizzle<typeof schema>>;

export interface MockDatabaseClient {
  sql: SqlClient;
  db: MockDb;
}

export function createMockDatabase(connectionUri: string): MockDatabaseClient {
  const sql = postgres(connectionUri, {
    max: 10,
    idle_timeout: 10,
    connect_timeout: 30,
    connection: {
      search_path: "unsa, demo, public",
    },
  });
  const db = drizzle(sql, { schema });
  return { sql, db };
}
