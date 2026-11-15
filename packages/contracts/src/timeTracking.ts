import * as Schema from "effect/Schema";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";

// Manual timesheets use calendar dates and wall-clock minutes, so a two-hour
// entry remains two hours when opened in another timezone or across DST.
export const TimeTrackingDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }),
);
const Id = TrimmedNonEmptyString.check(Schema.isMaxLength(100));
export const TimeTrackingCurrency = Schema.Literals(["CAD", "USD", "EUR", "GBP", "AUD", "CHF"]);
export type TimeTrackingCurrency = typeof TimeTrackingCurrency.Type;
const Rate = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100_000_000 }));
const Pricing = { hourlyRateCents: Schema.NullOr(Rate), currency: TimeTrackingCurrency };
// Omitted pricing from older clients preserves the saved rate, or uses the
// client's current default for a new entry. Null explicitly means unpriced.
const OptionalPricing = {
  hourlyRateCents: Schema.optionalKey(Schema.NullOr(Rate)),
  currency: Schema.optionalKey(TimeTrackingCurrency),
};
const ClientFields = {
  id: Id,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  color: Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  archived: Schema.Boolean,
  // Omission preserves saved defaults when an older client edits billing details.
  defaultModelSelection: Schema.optionalKey(Schema.NullOr(ModelSelection)),
};
export const TimeTrackingClient = Schema.Struct({
  ...ClientFields,
  ...Pricing,
  version: PositiveInt,
});
export type TimeTrackingClient = typeof TimeTrackingClient.Type;

const EntryFields = {
  id: Id,
  clientId: Id,
  date: TimeTrackingDate,
  startMinute: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1439 })),
  endMinute: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1440 })),
  task: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  notes: Schema.String.check(Schema.isMaxLength(4000)),
  projectId: Schema.optionalKey(Schema.NullOr(Id)),
};
export const TimeTrackingEntry = Schema.Struct({
  ...EntryFields,
  ...Pricing,
  version: PositiveInt,
});
export type TimeTrackingEntry = typeof TimeTrackingEntry.Type;

export const TimeTrackingListInput = Schema.Struct({
  from: TimeTrackingDate,
  to: TimeTrackingDate,
}).check(
  Schema.makeFilter(({ from, to }) => {
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    return days >= 0 && days <= 62;
  }),
);
export type TimeTrackingListInput = typeof TimeTrackingListInput.Type;
export const TimeTrackingSnapshot = Schema.Struct({
  clients: Schema.Array(TimeTrackingClient),
  entries: Schema.Array(TimeTrackingEntry),
});

export const TimeTrackingReportInput = Schema.Struct({
  from: TimeTrackingDate,
  to: TimeTrackingDate,
  // Null includes every client; an empty selection intentionally includes none.
  clientIds: Schema.NullOr(Schema.Array(Id).check(Schema.isMaxLength(500))),
  projectId: Schema.optionalKey(Schema.NullOr(Id)),
}).check(Schema.makeFilter(({ from, to }) => from <= to));
export type TimeTrackingReportInput = typeof TimeTrackingReportInput.Type;
export const TimeTrackingReportRow = Schema.Struct({
  clientId: Id,
  ...Pricing,
  minutes: NonNegativeInt,
  entryCount: NonNegativeInt,
  amountCents: Schema.NullOr(NonNegativeInt),
});
export type TimeTrackingReportRow = typeof TimeTrackingReportRow.Type;
export const TimeTrackingReport = Schema.Struct({
  from: TimeTrackingDate,
  to: TimeTrackingDate,
  clients: Schema.Array(TimeTrackingClient),
  rows: Schema.Array(TimeTrackingReportRow),
});

export const TimeTrackingMutation = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("client.save"),
    ...ClientFields,
    ...OptionalPricing,
    applyToUnratedEntries: Schema.optionalKey(Schema.Boolean),
    version: NonNegativeInt,
  }),
  Schema.Struct({
    type: Schema.Literal("entry.save"),
    ...EntryFields,
    ...OptionalPricing,
    version: NonNegativeInt,
  }).check(Schema.makeFilter(({ startMinute, endMinute }) => endMinute > startMinute)),
  Schema.Struct({ type: Schema.Literal("entry.delete"), id: Id, version: PositiveInt }),
  Schema.Struct({
    type: Schema.Literal("entry.move"),
    id: Id,
    version: PositiveInt,
    date: TimeTrackingDate,
    startMinute: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1439 })),
  }),
]);
export type TimeTrackingMutation = typeof TimeTrackingMutation.Type;

export class TimeTrackingError extends Schema.TaggedError<TimeTrackingError>()(
  "TimeTrackingError",
  { message: Schema.String },
) {}
