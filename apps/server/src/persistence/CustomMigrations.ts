import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";
import TimeTracking from "./CustomMigrations/054_TimeTracking.ts";
import TimeTrackingRates from "./CustomMigrations/055_TimeTrackingRates.ts";
import WorkspaceHub from "./CustomMigrations/056_WorkspaceHub.ts";
import ClientAiDefaults from "./CustomMigrations/057_ClientAiDefaults.ts";

const entries = [
  [1, "TimeTracking", TimeTracking],
  [2, "TimeTrackingRates", TimeTrackingRates],
  [3, "WorkspaceHub", WorkspaceHub],
  [4, "ClientAiDefaults", ClientAiDefaults],
] as const;

const run = Migrator.make({});

/** Move this fork's known legacy IDs out of upstream's namespace before V2 migrations run. */
export const runCustomMigrations = Effect.fn("runCustomMigrations")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`CREATE TABLE IF NOT EXISTS t3_custom_migrations (
      migration_id INTEGER PRIMARY KEY NOT NULL,
      created_at DATETIME NOT NULL DEFAULT current_timestamp,
      name VARCHAR(255) NOT NULL
    )`;
      const tables = yield* sql`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'effect_sql_migrations'`;
      if (tables.length === 0) return;
      for (const [id, name] of entries) {
        yield* sql`INSERT OR IGNORE INTO t3_custom_migrations (migration_id, created_at, name)
        SELECT ${id}, created_at, name FROM effect_sql_migrations
        WHERE migration_id = ${id + 53} AND name = ${name}`;
        yield* sql`DELETE FROM effect_sql_migrations
        WHERE migration_id = ${id + 53} AND name = ${name}`;
      }
    }),
  );
  return yield* run({
    table: "t3_custom_migrations",
    loader: Migrator.fromRecord(
      Object.fromEntries(entries.map(([id, name, migration]) => [`${id}_${name}`, migration])),
    ),
  });
});
