import { useNowMinute } from "../../hooks/useNowMinute";
import { hubListQuery } from "../../state/workspaceHub";
import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { timeTrackingReportQuery } from "../../state/timeTracking";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { dateKey, formatHours, movePeriod } from "./calendar";
import { formatMoney, reportCsv, reportRange, summarizeReport } from "./report";

export function TimeReports({ environmentId }: { environmentId: EnvironmentId }) {
  const nowMinute = useNowMinute();
  const hub = useEnvironmentQuery(hubListQuery({ environmentId, input: { search: "" } }));
  const [projectId, setProjectId] = useState("");
  const [period, setPeriod] = useState<"week" | "month" | "custom">("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [custom, setCustom] = useState(() => reportRange(new Date(), "week"));
  const [selected, setSelected] = useState<ReadonlyArray<string> | null>(null);
  const range = period === "custom" ? custom : reportRange(anchor, period);
  const valid = range.from !== "" && range.to !== "" && range.from <= range.to;
  // Reports carry aggregates, not transcripts or individual entries. Keeping all
  // client aggregates here lets checkbox filtering respond without a round trip.
  const query = useEnvironmentQuery(
    valid
      ? timeTrackingReportQuery({
          environmentId,
          input: { ...range, clientIds: null, projectId: projectId || null },
        })
      : null,
  );
  const clients = query.data?.clients ?? [];
  const rows = (query.data?.rows ?? []).filter(
    (row) => selected === null || selected.includes(row.clientId),
  );
  const summary = summarizeReport(rows);
  const refreshReport = query.refresh;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes the report when the window regains focus or visibility
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") refreshReport();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshReport]);
  const changePeriod = (value: "week" | "month" | "custom") => {
    if (value === "custom") setCustom(range);
    setPeriod(value);
  };
  const download = () => {
    if (!query.data || query.error) return;
    const blob = new Blob(["\uFEFF", reportCsv(range.from, range.to, rows, clients)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `time-report-${range.from}-to-${range.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="time-page-heading">
        <div>
          <p className="time-eyebrow">CLIENT WORK</p>
          <h1>Time & earnings.</h1>
          <p className="time-muted">Logged hours and their value, by client.</p>
        </div>
        <Button
          variant="outline"
          onClick={download}
          disabled={!query.data || !!query.error || rows.length === 0}
        >
          <DownloadIcon />
          Export CSV
        </Button>
      </div>
      <div className="time-toolbar">
        <label className="time-field">
          Project
          <select
            className="time-select"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">All projects</option>
            {(hub.data?.items ?? [])
              .filter((item) => item.kind === "project")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
          </select>
        </label>
        <div className="time-actions">
          <div className="time-view-switch" role="group" aria-label="Report period">
            {(["week", "month", "custom"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={period === value ? "secondary" : "ghost"}
                aria-pressed={period === value}
                onClick={() => changePeriod(value)}
              >
                {value === "week" ? "Week" : value === "month" ? "Month" : "Custom dates"}
              </Button>
            ))}
          </div>
          {period !== "custom" && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Previous report ${period}`}
                onClick={() => setAnchor(movePeriod(anchor, period, -1))}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Next report ${period}`}
                onClick={() => setAnchor(movePeriod(anchor, period, 1))}
              >
                <ChevronRightIcon />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
                This {period}
              </Button>
            </>
          )}
        </div>
        <div className="time-report-dates">
          <label className="time-field">
            From
            <Input
              type="date"
              value={range.from}
              onChange={(event) => {
                setCustom({ ...range, from: event.target.value });
                setPeriod("custom");
              }}
            />
          </label>
          <label className="time-field">
            Through
            <Input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(event) => {
                setCustom({ ...range, to: event.target.value });
                setPeriod("custom");
              }}
            />
          </label>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh report"
            disabled={!valid || query.isPending}
            onClick={query.refresh}
          >
            <RotateCwIcon />
          </Button>
        </div>
      </div>
      {!valid && (
        <p className="time-error time-load-error" role="alert">
          Choose a start date and an end date on or after it.
        </p>
      )}
      {query.error && (
        <p className="time-error time-load-error" role="alert">
          {query.error}{" "}
          <Button size="sm" variant="outline" onClick={query.refresh}>
            Retry
          </Button>
        </p>
      )}
      <div className="time-report-layout">
        <aside className="time-report-filters" aria-label="Report client filters">
          <div className="time-report-filter-heading">
            <h2>Clients</h2>
            <div className="time-actions">
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                All
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
            </div>
          </div>
          <p className="time-muted">
            {selected === null ? "All clients selected" : `${selected.length} selected`}
          </p>
          {clients.map((client) => (
            <label className="time-check-label" key={client.id}>
              <input
                type="checkbox"
                checked={selected === null || selected.includes(client.id)}
                onChange={(event) => {
                  const ids = selected ?? clients.map((item) => item.id);
                  setSelected(
                    event.target.checked
                      ? [...ids, client.id]
                      : ids.filter((id) => id !== client.id),
                  );
                }}
              />
              <span className="time-client-dot" style={{ backgroundColor: client.color }} />
              <span>
                {client.name}
                {client.archived && <small>Archived</small>}
              </span>
            </label>
          ))}
          {query.data && clients.length === 0 && (
            <p className="time-muted">Add clients from the Calendar view to get started.</p>
          )}
        </aside>
        <section className="time-report-content" aria-label="Time report">
          {!query.data ? (
            <p className="time-muted" role="status">
              {valid && !query.error
                ? "Loading report…"
                : "Choose a valid period and refresh to see the report."}
            </p>
          ) : (
            <>
              <div className="time-report-summary" aria-live="polite">
                <div>
                  <span>Tracked time</span>
                  <strong>{formatHours(summary.minutes)}</strong>
                  <small>{summary.entryCount} entries</small>
                </div>
                {summary.totals.map(([currency, amount]) => (
                  <div key={currency}>
                    <span>Tracked earnings · {currency}</span>
                    <strong>{formatMoney(amount, currency)}</strong>
                    <small>Before taxes · based on recorded rates</small>
                  </div>
                ))}
              </div>
              {summary.unpricedMinutes > 0 && (
                <p className="time-report-notice">
                  {formatHours(summary.unpricedMinutes)} has no rate and is excluded from earnings.
                  Edit those entries, or apply a rate to unpriced entries from Clients.
                </p>
              )}
              {rows.length === 0 ? (
                <div className="time-report-empty">
                  <h2>No time in this report</h2>
                  <p>Choose other dates or clients, or add time in the calendar.</p>
                </div>
              ) : (
                clients
                  .filter((client) => rows.some((row) => row.clientId === client.id))
                  .map((client) => {
                    const clientRows = rows.filter((row) => row.clientId === client.id);
                    const subtotal = summarizeReport(clientRows);
                    return (
                      <article key={client.id} className="time-report-client">
                        <header>
                          <span
                            className="time-client-dot"
                            style={{ backgroundColor: client.color }}
                          />
                          <h2>{client.name}</h2>
                          <span>{formatHours(subtotal.minutes)}</span>
                        </header>
                        <div className="time-report-table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Hourly rate</th>
                                <th>Time</th>
                                <th>Entries</th>
                                <th>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {clientRows.map((row) => (
                                <tr key={`${row.currency}:${row.hourlyRateCents}`}>
                                  <td>
                                    {row.hourlyRateCents === null
                                      ? `Not set (${row.currency})`
                                      : `${formatMoney(row.hourlyRateCents, row.currency)}/h`}
                                  </td>
                                  <td>{formatHours(row.minutes)}</td>
                                  <td>{row.entryCount}</td>
                                  <td>
                                    {row.amountCents === null
                                      ? "Not priced"
                                      : formatMoney(row.amountCents, row.currency)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <footer>
                          <span>Client total</span>
                          <div>
                            {subtotal.totals.map(([currency, amount]) => (
                              <strong key={currency}>{formatMoney(amount, currency)}</strong>
                            ))}
                            {subtotal.unpricedMinutes > 0 && (
                              <span>{formatHours(subtotal.unpricedMinutes)} unpriced</span>
                            )}
                          </div>
                        </footer>
                      </article>
                    );
                  })
              )}
              <p className="time-report-footnote">
                Amounts show recorded work before taxes, not payments received. Dates are inclusive.
                Amounts are rounded per entry to the nearest cent. Currencies are shown separately;
                no exchange rates are applied.
              </p>
            </>
          )}
        </section>
      </div>
      <footer className="time-footer">
        <span>
          {range.from} – {range.to}
        </span>
        <span>Report generated {dateKey(new Date(`${nowMinute}:00Z`))}</span>
      </footer>
    </>
  );
}
