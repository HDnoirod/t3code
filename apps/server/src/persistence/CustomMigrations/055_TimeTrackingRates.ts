import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Existing work has an unknown rate, not zero earnings. Only an explicit
  // correction/backfill should assign a price to previously recorded work.
  yield* sql`ALTER TABLE time_tracking_clients ADD COLUMN hourly_rate_cents INTEGER CHECK(hourly_rate_cents >= 0)`;
  yield* sql`ALTER TABLE time_tracking_clients ADD COLUMN currency TEXT NOT NULL DEFAULT 'CAD'`;
  yield* sql`ALTER TABLE time_tracking_entries ADD COLUMN hourly_rate_cents INTEGER CHECK(hourly_rate_cents >= 0)`;
  yield* sql`ALTER TABLE time_tracking_entries ADD COLUMN currency TEXT NOT NULL DEFAULT 'CAD'`;
});
