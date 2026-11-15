import {
  TimeTrackingClient,
  TimeTrackingEntry,
  TimeTrackingError,
  TimeTrackingListInput,
  TimeTrackingMutation,
  TimeTrackingReportInput,
  TimeTrackingReportRow,
  ModelSelection,
  type TimeTrackingCurrency,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const decodeRange = Schema.decodeUnknownEffect(TimeTrackingListInput);
const decodeReportInput = Schema.decodeUnknownEffect(TimeTrackingReportInput);
const decodeMutation = Schema.decodeUnknownEffect(TimeTrackingMutation);
const decodeClients = Schema.decodeUnknownEffect(Schema.Array(TimeTrackingClient));
const decodeEntries = Schema.decodeUnknownEffect(Schema.Array(TimeTrackingEntry));
const decodeReportRows = Schema.decodeUnknownEffect(Schema.Array(TimeTrackingReportRow));
const decodeModel = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.NullOr(ModelSelection)),
);
const encodeModel = Schema.encodeEffect(Schema.fromJsonString(Schema.NullOr(ModelSelection)));
const isTimeTrackingError = Schema.is(TimeTrackingError);
type Pricing = { readonly hourlyRateCents: number | null; readonly currency: TimeTrackingCurrency };

export const makeTimeTrackingStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const recover = (cause: unknown) =>
    isTimeTrackingError(cause)
      ? cause
      : new TimeTrackingError({
          message: "Could not save or load time tracking data. Please try again.",
        });
  const conflict = () =>
    new TimeTrackingError({
      message: "This record changed on another device. Refresh and reopen it before saving.",
    });
  const readClients = Effect.gen(function* () {
    const clients = yield* sql`SELECT id, name, color, archived, version,
      hourly_rate_cents AS "hourlyRateCents", currency, default_model_selection_json AS "defaultModel"
      FROM time_tracking_clients ORDER BY name COLLATE NOCASE`;
    return yield* decodeClients(
      yield* Effect.forEach(clients, (client) =>
        Effect.gen(function* () {
          return {
            ...client,
            archived: client.archived === 1,
            defaultModelSelection: yield* decodeModel(client.defaultModel ?? "null"),
          };
        }),
      ),
    );
  });

  const list = Effect.fn("TimeTracking.list")(function* (input: TimeTrackingListInput) {
    const { from, to } = yield* decodeRange(input);
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const clients = yield* readClients;
        const entries = yield* sql`SELECT id, client_id AS "clientId", date,
        start_minute AS "startMinute", end_minute AS "endMinute", task, notes, version, hub_project_id AS "projectId",
        hourly_rate_cents AS "hourlyRateCents", currency
        FROM time_tracking_entries WHERE date >= ${from} AND date <= ${to}
        ORDER BY date, start_minute, id LIMIT 5001`;
        if (entries.length > 5000)
          return yield* new TimeTrackingError({
            message: "Too many entries in this period. Choose a shorter period.",
          });
        return { clients, entries: yield* decodeEntries(entries) };
      }),
    );
  }, Effect.mapError(recover));

  const report = Effect.fn("TimeTracking.report")(function* (input: TimeTrackingReportInput) {
    const { from, to, clientIds, projectId } = yield* decodeReportInput(input);
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const clients = yield* readClients;
        if (clientIds?.length === 0) return { from, to, clients, rows: [] };
        const filter = clientIds === null ? sql`1 = 1` : sql.in("client_id", clientIds);
        // Round each entry once to the nearest cent using integer arithmetic.
        // Group currencies separately; never add dollar amounts across currencies.
        const rows = yield* sql`SELECT client_id AS "clientId", currency,
        hourly_rate_cents AS "hourlyRateCents", SUM(end_minute - start_minute) AS minutes,
        COUNT(*) AS "entryCount",
        SUM(((end_minute - start_minute) * hourly_rate_cents + 30) / 60) AS "amountCents"
        FROM time_tracking_entries WHERE date >= ${from} AND date <= ${to} AND ${filter} AND (${projectId ?? null} IS NULL OR hub_project_id = ${projectId ?? null})
        GROUP BY client_id, currency, hourly_rate_cents
        ORDER BY client_id, currency, hourly_rate_cents LIMIT 10001`;
        if (rows.length > 10000)
          return yield* new TimeTrackingError({
            message: "This report is too large. Choose fewer clients or a shorter period.",
          });
        return { from, to, clients, rows: yield* decodeReportRows(rows) };
      }),
    );
  }, Effect.mapError(recover));

  const mutate = Effect.fn("TimeTracking.mutate")(function* (input: TimeTrackingMutation) {
    const change = yield* decodeMutation(input);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        if (change.type === "client.save") {
          const previous = yield* sql<
            Pricing & { readonly defaultModel: string | null }
          >`SELECT hourly_rate_cents AS "hourlyRateCents", currency,
            default_model_selection_json AS "defaultModel" FROM time_tracking_clients WHERE id = ${change.id}`;
          const rate =
            change.hourlyRateCents === undefined
              ? (previous[0]?.hourlyRateCents ?? null)
              : change.hourlyRateCents;
          const currency = change.currency ?? previous[0]?.currency ?? "CAD";
          const defaultModel =
            change.defaultModelSelection === undefined
              ? (previous[0]?.defaultModel ?? null)
              : yield* encodeModel(change.defaultModelSelection);
          if (change.applyToUnratedEntries && rate === null)
            return yield* new TimeTrackingError({
              message: "Enter a rate before applying it to unpriced entries.",
            });
          const rows =
            change.version === 0
              ? yield* sql`INSERT INTO time_tracking_clients (id, name, color, archived, version, hourly_rate_cents, currency, default_model_selection_json)
              VALUES (${change.id}, ${change.name}, ${change.color}, ${Number(change.archived)}, 1, ${rate}, ${currency}, ${defaultModel})
              ON CONFLICT(id) DO NOTHING RETURNING id`
              : yield* sql`UPDATE time_tracking_clients SET name = ${change.name}, color = ${change.color},
              archived = ${Number(change.archived)}, version = version + 1, hourly_rate_cents = ${rate}, currency = ${currency}, default_model_selection_json = ${defaultModel}
              WHERE id = ${change.id} AND version = ${change.version} RETURNING id`;
          if (rows.length === 0) return yield* conflict();
          if (change.applyToUnratedEntries)
            yield* sql`UPDATE time_tracking_entries
          SET hourly_rate_cents = ${rate}, currency = ${currency}, version = version + 1
          WHERE client_id = ${change.id} AND hourly_rate_cents IS NULL`;
          return;
        }
        if (change.type === "entry.delete") {
          const rows = yield* sql`DELETE FROM time_tracking_entries WHERE id = ${change.id}
          AND version = ${change.version} RETURNING id`;
          if (rows.length === 0) return yield* conflict();
          return;
        }
        if (change.type === "entry.move") {
          const previous = yield* sql<{
            readonly duration: number;
          }>`SELECT end_minute - start_minute AS duration
          FROM time_tracking_entries WHERE id = ${change.id} AND version = ${change.version}`;
          if (!previous[0]) return yield* conflict();
          const end = change.startMinute + previous[0].duration;
          if (end > 1440)
            return yield* new TimeTrackingError({
              message: "This block would end after midnight. Choose an earlier start.",
            });
          yield* sql`UPDATE time_tracking_entries SET date = ${change.date}, start_minute = ${change.startMinute},
          end_minute = ${end}, version = version + 1 WHERE id = ${change.id} AND version = ${change.version}`;
          return;
        }
        const clients = yield* sql<Pricing & { readonly archived: number }>`SELECT archived,
        hourly_rate_cents AS "hourlyRateCents", currency FROM time_tracking_clients WHERE id = ${change.clientId}`;
        const client = clients[0];
        if (!client) return yield* new TimeTrackingError({ message: "Choose an existing client." });
        const previous = yield* sql<
          Pricing & { readonly clientId: string; readonly projectId: string | null }
        >`SELECT client_id AS "clientId",
        hourly_rate_cents AS "hourlyRateCents", currency, hub_project_id AS "projectId" FROM time_tracking_entries WHERE id = ${change.id}`;
        const projectId =
          change.projectId === undefined ? (previous[0]?.projectId ?? null) : change.projectId;
        if (projectId !== null) {
          const projects =
            yield* sql`SELECT id FROM workspace_hub WHERE id = ${projectId} AND kind = 'project'`;
          if (!projects.length)
            return yield* new TimeTrackingError({ message: "Choose an existing hub project." });
        }
        const sameClient = previous[0]?.clientId === change.clientId;
        if (client.archived && !sameClient)
          return yield* new TimeTrackingError({
            message: "Restore this client before adding time.",
          });
        const pricing = sameClient ? previous[0]! : client;
        const rate =
          change.hourlyRateCents === undefined ? pricing.hourlyRateCents : change.hourlyRateCents;
        const currency = change.currency ?? pricing.currency;
        const rows =
          change.version === 0
            ? yield* sql`INSERT INTO time_tracking_entries (id, client_id, date, start_minute, end_minute, task, notes, version, hourly_rate_cents, currency, hub_project_id)
            VALUES (${change.id}, ${change.clientId}, ${change.date}, ${change.startMinute}, ${change.endMinute}, ${change.task}, ${change.notes}, 1, ${rate}, ${currency}, ${projectId})
            ON CONFLICT(id) DO NOTHING RETURNING id`
            : yield* sql`UPDATE time_tracking_entries SET client_id = ${change.clientId}, date = ${change.date},
            start_minute = ${change.startMinute}, end_minute = ${change.endMinute}, task = ${change.task}, notes = ${change.notes},
            hourly_rate_cents = ${rate}, currency = ${currency}, hub_project_id = ${projectId}, version = version + 1
            WHERE id = ${change.id} AND version = ${change.version} RETURNING id`;
        if (rows.length === 0) return yield* conflict();
      }),
    );
  }, Effect.mapError(recover));
  return { list, report, mutate };
});
