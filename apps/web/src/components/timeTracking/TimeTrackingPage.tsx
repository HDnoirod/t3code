import { setActiveEnvironmentId } from "../../state/entities";
import { hubListQuery } from "../../state/workspaceHub";
import { randomUUID } from "../../lib/utils";
import type { EnvironmentId, TimeTrackingEntry } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Clock3Icon,
  PlusIcon,
  RotateCwIcon,
  UsersIcon,
  ChartNoAxesColumnIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { timeTrackingMutation, timeTrackingQuery } from "../../state/timeTracking";
import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { ClientsDialog } from "./ClientsDialog";
import { TimeEntryDialog, type EntryDraft, type SaveTimeChange } from "./TimeEntryDialog";
import { MonthCalendar, WeekCalendar } from "./CalendarGrid";
import { calendarDays, dateKey, formatHours, movePeriod } from "./calendar";
import "./timeTracking.css";
import { TimeReports } from "./TimeReports";

export function TimeTrackingPage() {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const [chosen, setChosen] = useState<EnvironmentId | null>(null);
  const [screen, setScreen] = useState<"calendar" | "reports">("calendar");
  const environmentId =
    environments.find((environment) => environment.environmentId === chosen)?.environmentId ??
    primary ??
    environments[0]?.environmentId;
  useEffect(() => {
    if (environmentId) setActiveEnvironmentId(environmentId);
  }, [environmentId]);
  return (
    <main className="time-page" data-seasonal-canvas>
      <header className={`time-titlebar ${isElectron ? "drag-region" : ""}`}>
        <CalendarDaysIcon size={17} />
        <span>Time tracking</span>
        {environments.length > 1 && (
          <label className="time-environment no-drag">
            <span className="sr-only">Environment</span>
            <select
              className="time-select"
              value={environmentId ?? ""}
              onChange={(event) =>
                setChosen(
                  environments.find(
                    (environment) => environment.environmentId === event.target.value,
                  )?.environmentId ?? null,
                )
              }
            >
              {environments.map((environment) => (
                <option key={environment.environmentId} value={environment.environmentId}>
                  {environment.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <div className="time-workspace-tabs" role="group" aria-label="Time tracking views">
        <Button
          size="sm"
          variant={screen === "calendar" ? "secondary" : "ghost"}
          aria-pressed={screen === "calendar"}
          onClick={() => setScreen("calendar")}
        >
          <CalendarDaysIcon />
          Calendar
        </Button>
        <Button
          size="sm"
          variant={screen === "reports" ? "secondary" : "ghost"}
          aria-pressed={screen === "reports"}
          onClick={() => setScreen("reports")}
        >
          <ChartNoAxesColumnIcon />
          Reports
        </Button>
      </div>
      {environmentId ? (
        screen === "calendar" ? (
          <TimeCalendar key={environmentId} environmentId={environmentId} />
        ) : (
          <TimeReports key={environmentId} environmentId={environmentId} />
        )
      ) : (
        <div className="time-empty">
          <Clock3Icon size={32} />
          <h1>Your time, in one place.</h1>
          <p>Connect a T3 environment to start tracking client work.</p>
        </div>
      )}
    </main>
  );
}

function TimeCalendar({ environmentId }: { environmentId: EnvironmentId }) {
  const hub = useEnvironmentQuery(hubListQuery({ environmentId, input: { search: "" } }));
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [filter, setFilter] = useState("");
  const [clientsOpen, setClientsOpen] = useState(false);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveMessage, setMoveMessage] = useState<{ error: boolean; text: string } | null>(null);
  const days = useMemo(() => calendarDays(anchor, view), [anchor, view]);
  const query = useEnvironmentQuery(
    timeTrackingQuery({
      environmentId,
      input: { from: dateKey(days[0]!), to: dateKey(days.at(-1)!) },
    }),
  );
  const mutate = useAtomCommand(timeTrackingMutation, { reportFailure: false });
  const clients = query.data?.clients ?? [];
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  const entries = (query.data?.entries ?? []).filter(
    (entry) => !filter || entry.clientId === filter,
  );
  const periodEntries = entries.filter(
    (entry) => view === "week" || entry.date.slice(0, 7) === dateKey(anchor).slice(0, 7),
  );
  const total = periodEntries.reduce((sum, entry) => sum + entry.endMinute - entry.startMinute, 0);
  const activeDays = new Set(periodEntries.map((entry) => entry.date)).size;
  const activeClients = new Set(periodEntries.map((entry) => entry.clientId)).size;
  const periodLabel =
    view === "month"
      ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : `${days[0]!.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${days[6]!.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  const refreshCalendar = query.refresh;
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") refreshCalendar();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshCalendar]);

  const save: SaveTimeChange = async (change) => {
    try {
      const result = await mutate({ environmentId, input: change });
      if (result._tag !== "Success") {
        const failure = squashAtomCommandFailure(result);
        return failure instanceof Error ? failure.message : "Could not save. Please try again.";
      }
      query.refresh();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Could not save. Please try again.";
    }
  };
  const add = (date: string, startMinute = 540, endMinute = 660) => {
    const client = filter
      ? clients.find((client) => client.id === filter && !client.archived)
      : clients.find((client) => !client.archived);
    if (!client) {
      setClientsOpen(true);
      return;
    }
    setDraft({
      type: "entry.save",
      id: randomUUID(),
      clientId: client.id,
      date,
      startMinute,
      endMinute,
      task: "",
      notes: "",
      hourlyRateCents: client.hourlyRateCents,
      currency: client.currency,
      version: 0,
    });
  };
  const edit = (entry: TimeTrackingEntry) => setDraft({ ...entry, type: "entry.save" });
  const move = async (entry: TimeTrackingEntry, date: string, startMinute: number) => {
    if (moving) return;
    setMoving(true);
    setMoveMessage(null);
    const error = await save({
      type: "entry.move",
      id: entry.id,
      version: entry.version,
      date,
      startMinute,
    });
    setMoveMessage({ error: error !== null, text: error ?? `Moved ${entry.task} to ${date}.` });
    setMoving(false);
  };
  return (
    <>
      <div className="time-page-heading">
        <div>
          <p className="time-eyebrow">CLIENT WORK</p>
          <h1>Make time count.</h1>
          <p className="time-muted">A clear picture of where your hours go.</p>
        </div>
        <div className="time-actions">
          <Button variant="outline" onClick={() => setClientsOpen(true)} disabled={!query.data}>
            <UsersIcon />
            Clients
          </Button>
          <Button onClick={() => add(dateKey(anchor))} disabled={!query.data}>
            <PlusIcon />
            Add time
          </Button>
        </div>
      </div>
      <div className="time-summary" aria-live="polite">
        <div>
          <span>
            {filter ? clientMap.get(filter)?.name : "Total time"} · this {view}
          </span>
          <strong>{query.data ? formatHours(total) : "—"}</strong>
        </div>
        <div>
          <span>Clients</span>
          <strong>{query.data ? activeClients : "—"}</strong>
        </div>
        <div>
          <span>Days with time</span>
          <strong>{query.data ? activeDays : "—"}</strong>
        </div>
        <p>
          <Clock3Icon size={16} />
          {view === "week"
            ? "Drag empty space to add time. Drag a block to move it; click to edit."
            : "Drag a block to another day. Click a date to see its week."}
        </p>
      </div>
      <div className="time-toolbar">
        <div className="time-actions">
          <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Previous ${view}`}
            onClick={() => setAnchor(movePeriod(anchor, view, -1))}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Next ${view}`}
            onClick={() => setAnchor(movePeriod(anchor, view, 1))}
          >
            <ChevronRightIcon />
          </Button>
          <h2>{periodLabel}</h2>
        </div>
        <div className="time-actions">
          <label>
            <span className="sr-only">Filter by client</span>
            <select
              className="time-select"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="">All clients</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                  {client.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="time-view-switch" role="group" aria-label="Calendar view">
            {(["week", "month"] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={view === mode ? "secondary" : "ghost"}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
              >
                {mode === "week" ? "Week" : "Month"}
              </Button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh calendar"
            disabled={query.isPending}
            onClick={query.refresh}
          >
            <RotateCwIcon />
          </Button>
        </div>
      </div>
      {query.error && (
        <div role="alert" className="time-error time-load-error">
          {query.error}{" "}
          <Button variant="outline" size="sm" onClick={query.refresh}>
            Retry
          </Button>
        </div>
      )}
      {(moving || moveMessage) && (
        <p
          className={`time-move-status ${moveMessage?.error ? "time-error" : "time-muted"}`}
          role={moveMessage?.error ? "alert" : "status"}
        >
          {moving ? "Moving entry…" : moveMessage?.text}
        </p>
      )}
      {!query.data ? (
        <div className="time-empty">
          <p role="status">
            {query.error ? "Your calendar could not be loaded." : "Loading your calendar…"}
          </p>
        </div>
      ) : clients.length === 0 ? (
        <div className="time-empty">
          <div className="time-empty-icon">
            <CalendarDaysIcon size={30} />
          </div>
          <h2>A little structure for your working week.</h2>
          <p>
            Add a client, then drag a block on the calendar.
            <br />
            Your hours and task notes will stay together.
          </p>
          <Button onClick={() => setClientsOpen(true)}>
            <PlusIcon />
            Add your first client
          </Button>
        </div>
      ) : view === "week" ? (
        <WeekCalendar
          days={days}
          entries={entries}
          clients={clientMap}
          onAdd={add}
          onEdit={edit}
          onMove={(...args) => void move(...args)}
          moving={moving}
        />
      ) : (
        <MonthCalendar
          days={days}
          month={anchor.getMonth()}
          entries={entries}
          clients={clientMap}
          onAdd={add}
          onEdit={edit}
          onMove={(...args) => void move(...args)}
          moving={moving}
          onShowDay={(day) => {
            setAnchor(day);
            setView("week");
          }}
        />
      )}
      <footer className="time-footer">
        <span>
          {periodEntries.length} {periodEntries.length === 1 ? "entry" : "entries"}
          {filter ? " for this client" : " across all clients"}
        </span>
        <span>15-minute blocks · Hours recorded as entered</span>
      </footer>
      {clientsOpen && (
        <ClientsDialog
          environmentId={environmentId}
          clients={clients}
          onClose={() => setClientsOpen(false)}
          onSave={save}
        />
      )}
      {draft && (
        <TimeEntryDialog
          projects={(hub.data?.items ?? []).filter((item) => item.kind === "project")}
          key={draft.id}
          draft={draft}
          clients={clients}
          onClose={() => setDraft(null)}
          onSave={save}
        />
      )}
    </>
  );
}
