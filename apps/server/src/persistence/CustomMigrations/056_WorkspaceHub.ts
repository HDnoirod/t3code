import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE workspace_hub (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, version INTEGER NOT NULL,
    data TEXT NOT NULL CHECK(json_valid(data)), search_text TEXT NOT NULL
  )`;
  yield* sql`ALTER TABLE time_tracking_entries ADD COLUMN hub_project_id TEXT`;
  yield* sql`CREATE INDEX time_tracking_project_date ON time_tracking_entries(hub_project_id, date)`;
});
