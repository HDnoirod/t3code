import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS time_tracking_clients (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1
  )`;
  yield* sql`CREATE TABLE IF NOT EXISTS time_tracking_entries (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES time_tracking_clients(id),
    date TEXT NOT NULL, start_minute INTEGER NOT NULL CHECK(start_minute >= 0),
    end_minute INTEGER NOT NULL CHECK(end_minute <= 1440 AND end_minute > start_minute),
    task TEXT NOT NULL, notes TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS time_tracking_entries_date ON time_tracking_entries(date)`;
});
