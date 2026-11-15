import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import initialMigration from "./CustomMigrations/054_TimeTracking.ts";
import hubMigration from "./CustomMigrations/056_WorkspaceHub.ts";
import ratesMigration from "./CustomMigrations/055_TimeTrackingRates.ts";
import defaultsMigration from "./CustomMigrations/057_ClientAiDefaults.ts";
import { ProviderInstanceId } from "@t3tools/contracts";
import { layerMemory as SqlitePersistenceMemory } from "./Sqlite.ts";
import { makeTimeTrackingStore } from "./TimeTracking.ts";

const client = {
  type: "client.save",
  id: "acme",
  name: "Acme",
  color: "#6366f1",
  archived: false,
  version: 0,
} as const;
const entry = {
  type: "entry.save",
  id: "work",
  clientId: "acme",
  date: "2026-11-07",
  startMinute: 600,
  endMinute: 720,
  task: "Website",
  notes: "Homepage",
  version: 0,
} as const;
const range = { from: "2026-11-02", to: "2026-11-08" };

it.effect(
  "persists client AI defaults, preserves older edits, and clears inheritance explicitly",
  () =>
    Effect.gen(function* () {
      const store = yield* makeTimeTrackingStore;
      const selection = {
        instanceId: ProviderInstanceId.make("claude_work"),
        model: "claude-model",
      };
      yield* store.mutate({ ...client, defaultModelSelection: selection });
      const reopened = yield* makeTimeTrackingStore;
      assert.deepEqual((yield* reopened.list(range)).clients[0]?.defaultModelSelection, selection);
      yield* reopened.mutate({ ...client, version: 1, name: "Changed from an older device" });
      assert.deepEqual((yield* reopened.list(range)).clients[0]?.defaultModelSelection, selection);
      assert.equal(
        (yield* Effect.result(
          reopened.mutate({ ...client, version: 1, defaultModelSelection: null }),
        ))._tag,
        "Failure",
      );
      assert.deepEqual((yield* reopened.list(range)).clients[0]?.defaultModelSelection, selection);
      yield* reopened.mutate({ ...client, version: 2, defaultModelSelection: null });
      assert.equal(
        (yield* reopened.report({ ...range, clientIds: null })).clients[0]?.defaultModelSelection,
        null,
      );
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect(
  "persists clients and time across store instances, filters dates, edits and deletes",
  () =>
    Effect.gen(function* () {
      const store = yield* makeTimeTrackingStore;
      yield* store.mutate(client);
      yield* store.mutate(entry);
      yield* store.mutate({ ...entry, id: "outside", date: "2026-12-01" });
      const secondConnection = yield* makeTimeTrackingStore;
      const snapshot = yield* secondConnection.list(range);
      assert.equal(snapshot.clients[0]?.name, "Acme");
      assert.equal(snapshot.entries.length, 1);
      assert.equal(snapshot.entries[0]?.endMinute, 720);
      yield* secondConnection.mutate({ ...entry, version: 1, endMinute: 780 });
      assert.equal((yield* store.list(range)).entries[0]?.version, 2);
      yield* store.mutate({ type: "entry.delete", id: entry.id, version: 2 });
      assert.equal((yield* store.list(range)).entries.length, 0);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("rejects stale edits and deletes without losing the newer entry", () =>
  Effect.gen(function* () {
    const store = yield* makeTimeTrackingStore;
    yield* store.mutate(client);
    yield* store.mutate(entry);
    yield* store.mutate({ ...entry, version: 1, task: "New title" });
    assert.equal((yield* Effect.result(store.mutate({ ...entry, version: 1 })))._tag, "Failure");
    assert.equal(
      (yield* Effect.result(store.mutate({ type: "entry.delete", id: entry.id, version: 1 })))._tag,
      "Failure",
    );
    assert.equal((yield* store.list(range)).entries[0]?.task, "New title");
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("archives and restores clients while retaining their history", () =>
  Effect.gen(function* () {
    const store = yield* makeTimeTrackingStore;
    yield* store.mutate(client);
    yield* store.mutate(entry);
    yield* store.mutate({ ...client, version: 1, archived: true });
    const archived = yield* store.list(range);
    assert.equal(archived.clients[0]?.archived, true);
    assert.equal(archived.entries.length, 1);
    assert.equal((yield* Effect.result(store.mutate({ ...entry, id: "new" })))._tag, "Failure");
    yield* store.mutate({ ...entry, version: 1, notes: "Corrected" });
    yield* store.mutate({ ...client, version: 2 });
    yield* store.mutate({ ...entry, id: "new" });
    assert.equal((yield* store.list(range)).entries.length, 2);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("rejects invalid dates, durations, ranges and missing clients", () =>
  Effect.gen(function* () {
    const store = yield* makeTimeTrackingStore;
    assert.equal((yield* Effect.result(store.mutate(entry)))._tag, "Failure");
    yield* store.mutate(client);
    for (const invalid of [
      { ...entry, date: "2026-02-30" },
      { ...entry, endMinute: 500 },
      { ...entry, endMinute: 1500 },
      { ...entry, startMinute: -1 },
      { ...entry, task: " " },
    ])
      assert.equal((yield* Effect.result(store.mutate(invalid)))._tag, "Failure");
    assert.equal(
      (yield* Effect.result(store.list({ from: "2026-01-01", to: "2026-12-31" })))._tag,
      "Failure",
    );
    assert.equal((yield* store.list(range)).entries.length, 0);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);
it.effect(
  "upgrades the original calendar without inventing historical rates or losing records",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* initialMigration;
      yield* sql`INSERT INTO time_tracking_clients (id, name, color) VALUES ('acme', 'Acme', '#6366f1')`;
      yield* sql`INSERT INTO time_tracking_entries (id, client_id, date, start_minute, end_minute, task, notes)
      VALUES ('work', 'acme', '2026-11-07', 600, 720, 'Website', 'Homepage')`;
      yield* ratesMigration;
      yield* hubMigration;
      yield* defaultsMigration;
      const store = yield* makeTimeTrackingStore;
      const data = yield* store.list(range);
      assert.equal(data.clients[0]?.hourlyRateCents, null);
      assert.equal(data.clients[0]?.currency, "CAD");
      assert.equal(data.clients[0]?.defaultModelSelection, null);
      assert.deepEqual(data.entries[0], {
        id: entry.id,
        clientId: entry.clientId,
        date: entry.date,
        startMinute: 600,
        endMinute: 720,
        task: "Website",
        notes: "Homepage",
        version: 1,
        hourlyRateCents: null,
        currency: "CAD",
        projectId: null,
      });
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect(
  "snapshots rates and currencies, preserves omitted pricing, and prices reassigned work",
  () =>
    Effect.gen(function* () {
      const store = yield* makeTimeTrackingStore;
      yield* store.mutate({ ...client, hourlyRateCents: 10000, currency: "CAD" });
      yield* store.mutate(entry);
      yield* store.mutate({ ...client, version: 1, hourlyRateCents: 12500, currency: "USD" });
      yield* store.mutate({ ...client, version: 2, name: "Renamed" });
      yield* store.mutate({ ...entry, version: 1, notes: "Corrected" });
      yield* store.mutate({ ...entry, id: "new" });
      let data = yield* store.list(range);
      assert.equal(data.clients[0]?.hourlyRateCents, 12500);
      assert.equal(data.clients[0]?.currency, "USD");
      assert.equal(data.entries.find((item) => item.id === "work")?.hourlyRateCents, 10000);
      assert.equal(data.entries.find((item) => item.id === "work")?.currency, "CAD");
      assert.equal(data.entries.find((item) => item.id === "new")?.hourlyRateCents, 12500);
      yield* store.mutate({ ...client, id: "other", hourlyRateCents: 8000, currency: "EUR" });
      yield* store.mutate({ ...entry, version: 2, clientId: "other" });
      data = yield* store.list(range);
      assert.equal(data.entries.find((item) => item.id === "work")?.hourlyRateCents, 8000);
      assert.equal(data.entries.find((item) => item.id === "work")?.currency, "EUR");
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("backfills only unpriced entries and invalidates stale editors atomically", () =>
  Effect.gen(function* () {
    const store = yield* makeTimeTrackingStore;
    yield* store.mutate(client);
    yield* store.mutate(entry);
    yield* store.mutate({ ...entry, id: "free", hourlyRateCents: 0 });
    yield* store.mutate({ ...entry, id: "priced", hourlyRateCents: 5000 });
    assert.equal(
      (yield* Effect.result(store.mutate({ ...client, version: 1, applyToUnratedEntries: true })))
        ._tag,
      "Failure",
    );
    yield* store.mutate({
      ...client,
      version: 1,
      hourlyRateCents: 10000,
      currency: "USD",
      applyToUnratedEntries: true,
    });
    const data = yield* store.list(range);
    assert.equal(data.entries.find((item) => item.id === "work")?.hourlyRateCents, 10000);
    assert.equal(data.entries.find((item) => item.id === "work")?.currency, "USD");
    assert.equal(data.entries.find((item) => item.id === "work")?.version, 2);
    assert.equal(data.entries.find((item) => item.id === "free")?.hourlyRateCents, 0);
    assert.equal(data.entries.find((item) => item.id === "free")?.version, 1);
    assert.equal(data.entries.find((item) => item.id === "priced")?.hourlyRateCents, 5000);
    assert.equal((yield* Effect.result(store.mutate({ ...entry, version: 1 })))._tag, "Failure");
    assert.equal(
      (yield* Effect.result(
        store.mutate({ ...client, version: 1, hourlyRateCents: 999, applyToUnratedEntries: true }),
      ))._tag,
      "Failure",
    );
    assert.equal((yield* store.list(range)).clients[0]?.hourlyRateCents, 10000);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("moves an entry without changing duration, task, client, notes or historical rate", () =>
  Effect.gen(function* () {
    const store = yield* makeTimeTrackingStore;
    yield* store.mutate({ ...client, hourlyRateCents: 9500 });
    yield* store.mutate(entry);
    const move = {
      type: "entry.move",
      id: entry.id,
      version: 1,
      date: "2026-11-08",
      startMinute: 780,
    } as const;
    yield* store.mutate(move);
    const moved = (yield* store.list(range)).entries[0]!;
    assert.deepEqual(moved, {
      id: entry.id,
      clientId: entry.clientId,
      task: entry.task,
      notes: entry.notes,
      date: "2026-11-08",
      startMinute: 780,
      endMinute: 900,
      version: 2,
      hourlyRateCents: 9500,
      currency: "CAD",
      projectId: null,
    });
    assert.equal((yield* Effect.result(store.mutate(move)))._tag, "Failure");
    assert.equal(
      (yield* Effect.result(store.mutate({ ...move, version: 2, startMinute: 1400 })))._tag,
      "Failure",
    );
    assert.deepEqual((yield* store.list(range)).entries[0], moved);
    yield* store.mutate({ ...move, version: 2, date: "2026-12-01", startMinute: 1320 });
    assert.equal((yield* store.report({ ...range, clientIds: null })).rows.length, 0);
    const december = yield* store.report({ from: "2026-12-01", to: "2026-12-01", clientIds: null });
    assert.equal(december.rows[0]?.amountCents, 19000);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect(
  "reports inclusive date ranges, selected clients, archived history and separate rate/currency totals",
  () =>
    Effect.gen(function* () {
      const store = yield* makeTimeTrackingStore;
      yield* store.mutate({ ...client, hourlyRateCents: 10000 });
      yield* store.mutate({ ...client, id: "b", hourlyRateCents: 2000, currency: "EUR" });
      yield* store.mutate({ ...entry, date: range.from });
      yield* store.mutate({ ...entry, id: "last", date: range.to, hourlyRateCents: 12000 });
      yield* store.mutate({ ...entry, id: "usd", hourlyRateCents: 5000, currency: "USD" });
      yield* store.mutate({ ...entry, id: "b", clientId: "b" });
      yield* store.mutate({ ...entry, id: "before", date: "2026-11-01" });
      yield* store.mutate({ ...entry, id: "after", date: "2026-11-09" });
      yield* store.mutate({ ...client, version: 1, archived: true });
      const report = yield* store.report({ ...range, clientIds: null });
      assert.equal(report.rows.length, 4);
      assert.deepEqual(
        report.rows.map((row) => [
          row.clientId,
          row.currency,
          row.hourlyRateCents,
          row.minutes,
          row.amountCents,
        ]),
        [
          ["acme", "CAD", 10000, 120, 20000],
          ["acme", "CAD", 12000, 120, 24000],
          ["acme", "USD", 5000, 120, 10000],
          ["b", "EUR", 2000, 120, 4000],
        ],
      );
      assert.equal(report.clients.find((item) => item.id === "acme")?.archived, true);
      assert.equal((yield* store.report({ ...range, clientIds: ["b"] })).rows.length, 1);
      assert.equal((yield* store.report({ ...range, clientIds: ["acme", "b"] })).rows.length, 4);
      assert.equal((yield* store.report({ ...range, clientIds: [] })).rows.length, 0);
      assert.equal((yield* store.report({ ...range, clientIds: ["missing"] })).rows.length, 0);
      const year = yield* store.report({ from: "2026-01-01", to: "2026-12-31", clientIds: null });
      assert.equal(
        year.rows.reduce((sum, row) => sum + row.entryCount, 0),
        6,
      );
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("rounds earnings per entry and distinguishes unpriced work from unpaid work", () =>
  Effect.gen(function* () {
    const store = yield* makeTimeTrackingStore;
    yield* store.mutate(client);
    yield* store.mutate(entry);
    yield* store.mutate({ ...entry, id: "free", hourlyRateCents: 0 });
    for (const id of ["a", "b"])
      yield* store.mutate({ ...entry, id, startMinute: 0, endMinute: 1, hourlyRateCents: 100 });
    yield* store.mutate({
      ...entry,
      id: "half-cent",
      startMinute: 0,
      endMinute: 30,
      hourlyRateCents: 1,
    });
    const rows = (yield* store.report({ ...range, clientIds: null })).rows;
    assert.equal(rows.find((row) => row.hourlyRateCents === null)?.amountCents, null);
    assert.equal(rows.find((row) => row.hourlyRateCents === 0)?.amountCents, 0);
    assert.equal(rows.find((row) => row.hourlyRateCents === 100)?.amountCents, 4);
    assert.equal(rows.find((row) => row.hourlyRateCents === 1)?.amountCents, 1);
    for (const hourlyRateCents of [-1, 1.5, 100_000_001]) {
      assert.equal(
        (yield* Effect.result(store.mutate({ ...client, version: 1, hourlyRateCents })))._tag,
        "Failure",
      );
    }
    assert.equal(
      (yield* Effect.result(
        store.report({ from: "2026-11-08", to: "2026-11-07", clientIds: null }),
      ))._tag,
      "Failure",
    );
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);
