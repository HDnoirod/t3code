import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runMigrations } from "./Migrations.ts";
import { runCustomMigrations } from "./CustomMigrations.ts";
import TimeTracking from "./CustomMigrations/054_TimeTracking.ts";
import TimeTrackingRates from "./CustomMigrations/055_TimeTrackingRates.ts";
import WorkspaceHub from "./CustomMigrations/056_WorkspaceHub.ts";
import ClientAiDefaults from "./CustomMigrations/057_ClientAiDefaults.ts";

it.effect(
  "upgrades the custom 0.0.42 ledger without losing records or skipping upstream migrations",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 53 });
      for (const [id, name, migration] of [
        [54, "TimeTracking", TimeTracking],
        [55, "TimeTrackingRates", TimeTrackingRates],
        [56, "WorkspaceHub", WorkspaceHub],
        [57, "ClientAiDefaults", ClientAiDefaults],
      ] as const) {
        yield* migration;
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
      }
      yield* sql`INSERT INTO time_tracking_clients (id,name,color,default_model_selection_json) VALUES ('client','My client','#123456','{"instanceId":"codex_work","model":"test"}')`;
      yield* sql`INSERT INTO time_tracking_entries (id,client_id,date,start_minute,end_minute,task,notes) VALUES ('time','client','2026-11-01',60,120,'Consulting','Details')`;
      yield* sql`INSERT INTO workspace_hub (id,kind,version,data,search_text) VALUES ('hub','project',3,'{"body":"Project brief"}','Project brief')`;
      const before = yield* sql`SELECT * FROM time_tracking_clients`;
      const time = yield* sql`SELECT * FROM time_tracking_entries`;
      const hub = yield* sql`SELECT * FROM workspace_hub`;
      yield* runMigrations();
      assert.deepEqual(yield* sql`SELECT * FROM time_tracking_clients`, before);
      assert.deepEqual(yield* sql`SELECT * FROM time_tracking_entries`, time);
      assert.deepEqual(yield* sql`SELECT * FROM workspace_hub`, hub);
      assert.deepEqual(
        (yield* sql`SELECT name FROM effect_sql_migrations WHERE migration_id = 55`).map(
          (row) => row.name,
        ),
        ["OrchestrationV2"],
      );
      assert.lengthOf(yield* sql`SELECT * FROM t3_custom_migrations`, 4);
      assert.deepEqual(yield* runMigrations(), []);
      assert.deepEqual(yield* runCustomMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
