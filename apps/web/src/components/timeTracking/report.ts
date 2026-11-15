import type {
  TimeTrackingClient,
  TimeTrackingCurrency,
  TimeTrackingReportRow,
} from "@t3tools/contracts";
import { addDays, dateKey, weekStart } from "./calendar";

export function parseRate(value: string): number | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents <= 100_000_000 ? cents : null;
}
export function rateText(rate: number | null | undefined) {
  return rate == null ? "" : (rate / 100).toFixed(2);
}
export function formatMoney(cents: number, currency: TimeTrackingCurrency): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(cents / 100);
}
export function reportRange(anchor: Date, period: "week" | "month") {
  return period === "week"
    ? { from: dateKey(weekStart(anchor)), to: dateKey(addDays(weekStart(anchor), 6)) }
    : {
        from: dateKey(new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12)),
        to: dateKey(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12)),
      };
}
export function summarizeReport(rows: ReadonlyArray<TimeTrackingReportRow>) {
  const totals = new Map<TimeTrackingCurrency, number>();
  let minutes = 0;
  let unpricedMinutes = 0;
  let entryCount = 0;
  for (const row of rows) {
    minutes += row.minutes;
    entryCount += row.entryCount;
    if (row.amountCents === null) unpricedMinutes += row.minutes;
    else totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amountCents);
  }
  return {
    minutes,
    unpricedMinutes,
    entryCount,
    totals: [...totals].sort(([a], [b]) => a.localeCompare(b)),
  };
}

// Keep user-entered client names as text when a report is opened in a spreadsheet.
function csvCell(value: string) {
  const safe = /^\s*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function reportCsv(
  from: string,
  to: string,
  rows: ReadonlyArray<TimeTrackingReportRow>,
  clients: ReadonlyArray<TimeTrackingClient>,
) {
  const names = new Map(clients.map((client) => [client.id, client.name]));
  return [
    [
      "From",
      "Through",
      "Client",
      "Currency",
      "Hourly rate",
      "Minutes",
      "Hours",
      "Entries",
      "Amount",
    ],
    ...rows.map((row) => [
      from,
      to,
      names.get(row.clientId) ?? row.clientId,
      row.currency,
      rateText(row.hourlyRateCents),
      String(row.minutes),
      (row.minutes / 60).toFixed(4),
      String(row.entryCount),
      rateText(row.amountCents),
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
