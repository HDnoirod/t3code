import { useNowMinute } from "../../hooks/useNowMinute";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { TimeTrackingClient, TimeTrackingEntry } from "@t3tools/contracts";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type PointerEvent,
} from "react";
import { PlusIcon } from "lucide-react";
import { clockTime, dateKey, dragRange, formatHours, layoutEntries } from "./calendar";
import { useTimeEntryMove } from "./useTimeEntryMove";

const HOUR_HEIGHT = 56;
type NewTime = (date: string, startMinute?: number, endMinute?: number) => void;
type GridProps = {
  days: Date[];
  entries: ReadonlyArray<TimeTrackingEntry>;
  clients: ReadonlyMap<string, TimeTrackingClient>;
  onAdd: NewTime;
  onEdit: (entry: TimeTrackingEntry) => void;
  onMove: (entry: TimeTrackingEntry, date: string, startMinute: number) => void;
  moving: boolean;
};
const dayLabel = (date: Date) =>
  date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const eventStyle = (color: string | undefined): CSSProperties =>
  ({ "--client-color": color ?? "#6366f1" }) as CSSProperties;

function EventButton({ details, ...props }: ComponentProps<"button"> & { details: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button {...props} />} />
      <TooltipPopup>{details}</TooltipPopup>
    </Tooltip>
  );
}

export function WeekCalendar({ days, entries, clients, onAdd, onEdit, onMove, moving }: GridProps) {
  const nowMinute = useNowMinute();
  const scroll = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const { entryProps, preview } = useTimeEntryMove({
    root: body,
    mode: "week",
    busy: moving,
    onMove,
    onEdit,
  });
  const drag = useRef<{ date: string; start: number; end: number } | null>(null);
  const [selection, setSelection] = useState<{
    date: string;
    startMinute: number;
    endMinute: number;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- positions the calendar scroll container at the start of the working day
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = HOUR_HEIGHT * 8;
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the Escape listener while the selection grid is mounted
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        drag.current = null;
        setSelection(null);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);
  const minuteAt = (event: PointerEvent<HTMLDivElement>) =>
    ((event.clientY - event.currentTarget.getBoundingClientRect().top) / HOUR_HEIGHT) * 60;
  return (
    <div className="time-week-scroll" ref={scroll}>
      <div className="time-week">
        <div className="time-week-heading">
          <span className="time-zone">Hours</span>
          {days.map((day) => {
            const key = dateKey(day);
            const minutes = entries
              .filter((entry) => entry.date === key)
              .reduce((sum, entry) => sum + entry.endMinute - entry.startMinute, 0);
            return (
              <button
                type="button"
                key={key}
                className="time-day-heading"
                data-today={key === dateKey(new Date(`${nowMinute}:00Z`))}
                onClick={() => onAdd(key)}
                aria-label={`Add time on ${dayLabel(day)}`}
              >
                <span>{day.toLocaleDateString(undefined, { weekday: "short" })}</span>
                <strong>{day.getDate()}</strong>
                <small>{minutes ? formatHours(minutes) : "–"}</small>
              </button>
            );
          })}
        </div>
        <div className="time-week-body" ref={body}>
          <div className="time-hours" aria-hidden="true">
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>
                {clockTime(hour * 60)}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const key = dateKey(day);
            return (
              <div
                key={key}
                className="time-day-column"
                data-time-date={key}
                data-today={key === dateKey(new Date(`${nowMinute}:00Z`))}
                style={{ height: 24 * HOUR_HEIGHT }}
                onPointerDown={(event) => {
                  if (
                    moving ||
                    event.button !== 0 ||
                    !event.isPrimary ||
                    event.pointerType === "touch" ||
                    (event.target instanceof Element && event.target.closest("button"))
                  )
                    return;
                  event.preventDefault();
                  const minute = minuteAt(event);
                  drag.current = { date: key, start: minute, end: minute };
                  setSelection({ date: key, ...dragRange(minute, minute) });
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const current = drag.current;
                  if (!current || current.date !== key) return;
                  current.end = minuteAt(event);
                  setSelection({ date: key, ...dragRange(current.start, current.end) });
                }}
                onPointerUp={(event) => {
                  const current = drag.current;
                  if (!current) return;
                  drag.current = null;
                  setSelection(null);
                  const range = dragRange(current.start, minuteAt(event));
                  onAdd(key, range.startMinute, range.endMinute);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setSelection(null);
                }}
                onLostPointerCapture={() => {
                  drag.current = null;
                  setSelection(null);
                }}
              >
                {layoutEntries(entries.filter((entry) => entry.date === key)).map(
                  ({ entry, lane, lanes }) => {
                    const client = clients.get(entry.clientId);
                    return (
                      <EventButton
                        key={entry.id}
                        type="button"
                        className="time-event"
                        {...entryProps(entry)}
                        details={`${client?.name}: ${entry.task}\n${clockTime(entry.startMinute)}–${clockTime(entry.endMinute)} · ${formatHours(entry.endMinute - entry.startMinute)}`}
                        aria-label={`Edit ${entry.task}, ${client?.name}, ${formatHours(entry.endMinute - entry.startMinute)}`}
                        style={{
                          ...eventStyle(client?.color),
                          top: (entry.startMinute / 60) * HOUR_HEIGHT,
                          height: ((entry.endMinute - entry.startMinute) / 60) * HOUR_HEIGHT - 1,
                          left: `calc(${(lane / lanes) * 100}% + 2px)`,
                          width: `calc(${100 / lanes}% - 4px)`,
                        }}
                      >
                        <strong>{entry.task}</strong>
                        <span>{client?.name}</span>
                        <small>
                          {clockTime(entry.startMinute)} ·{" "}
                          {formatHours(entry.endMinute - entry.startMinute)}
                        </small>
                      </EventButton>
                    );
                  },
                )}
                {selection?.date === key && (
                  <div
                    className="time-selection"
                    style={{
                      top: (selection.startMinute / 60) * HOUR_HEIGHT,
                      height: ((selection.endMinute - selection.startMinute) / 60) * HOUR_HEIGHT,
                    }}
                  >
                    {formatHours(selection.endMinute - selection.startMinute)}
                  </div>
                )}
                {preview?.date === key && (
                  <div
                    className="time-selection time-move-preview"
                    style={{
                      top: (preview.startMinute / 60) * HOUR_HEIGHT,
                      height: ((preview.endMinute - preview.startMinute) / 60) * HOUR_HEIGHT,
                    }}
                  >
                    {clockTime(preview.startMinute)}–{clockTime(preview.endMinute)} ·{" "}
                    {formatHours(preview.endMinute - preview.startMinute)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function MonthCalendar({
  days,
  month,
  entries,
  clients,
  onAdd,
  onEdit,
  onMove,
  moving,
  onShowDay,
}: GridProps & { month: number; onShowDay: (day: Date) => void }) {
  const nowMinute = useNowMinute();
  const body = useRef<HTMLDivElement>(null);
  const { entryProps, preview } = useTimeEntryMove({
    root: body,
    mode: "month",
    busy: moving,
    onMove,
    onEdit,
  });
  return (
    <div className="time-month-scroll">
      <div className="time-month" ref={body}>
        {days.slice(0, 7).map((day) => (
          <div className="time-month-weekday" key={dateKey(day)}>
            {day.toLocaleDateString(undefined, { weekday: "short" })}
          </div>
        ))}
        {days.map((day) => {
          const key = dateKey(day);
          const daily = entries.filter((entry) => entry.date === key);
          const minutes = daily.reduce(
            (sum, entry) => sum + entry.endMinute - entry.startMinute,
            0,
          );
          return (
            <div
              key={key}
              className="time-month-day"
              data-time-date={key}
              data-drop-target={preview?.date === key}
              data-outside={day.getMonth() !== month}
              data-today={key === dateKey(new Date(`${nowMinute}:00Z`))}
            >
              <div className="time-month-date">
                <button
                  type="button"
                  onClick={() => onShowDay(day)}
                  aria-label={`Show week of ${dayLabel(day)}`}
                >
                  {day.getDate()}
                </button>
                {minutes > 0 && <span>{formatHours(minutes)}</span>}
                <button
                  type="button"
                  onClick={() => onAdd(key)}
                  aria-label={`Add time on ${dayLabel(day)}`}
                >
                  <PlusIcon size={13} />
                </button>
              </div>
              {daily.slice(0, 3).map((entry) => (
                <EventButton
                  type="button"
                  key={entry.id}
                  className="time-month-event"
                  style={eventStyle(clients.get(entry.clientId)?.color)}
                  details={`${clients.get(entry.clientId)?.name}: ${entry.task} · ${formatHours(entry.endMinute - entry.startMinute)}`}
                  {...entryProps(entry)}
                >
                  <span>{entry.task}</span>
                  <strong>{formatHours(entry.endMinute - entry.startMinute)}</strong>
                </EventButton>
              ))}
              {daily.length > 3 && (
                <button type="button" className="time-month-more" onClick={() => onShowDay(day)}>
                  +{daily.length - 3} more
                </button>
              )}
              {preview?.date === key && (
                <div className="time-month-drop-preview">
                  Move here · {clockTime(preview.startMinute)} ·{" "}
                  {formatHours(preview.endMinute - preview.startMinute)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
