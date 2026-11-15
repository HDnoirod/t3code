import type { TimeTrackingEntry } from "@t3tools/contracts";

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function calendarDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
export function weekStart(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7));
}
export function calendarDays(date: Date, view: "week" | "month"): Date[] {
  const start = weekStart(
    view === "week" ? date : new Date(date.getFullYear(), date.getMonth(), 1, 12),
  );
  return Array.from({ length: view === "week" ? 7 : 42 }, (_, index) => addDays(start, index));
}
export function movePeriod(date: Date, view: "week" | "month", direction: number): Date {
  return view === "week"
    ? addDays(date, direction * 7)
    : new Date(date.getFullYear(), date.getMonth() + direction, 1, 12);
}
export function formatHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : hours === 0 ? `${remainder}m` : `${hours}h ${remainder}m`;
}
export function clockTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
export function dragRange(start: number, end: number) {
  const snap = (minute: number) => Math.max(0, Math.min(1440, Math.round(minute / 15) * 15));
  const startMinute = Math.min(snap(start), snap(end), 1425);
  return {
    startMinute,
    endMinute: Math.max(snap(start), snap(end), startMinute + 15),
  };
}

// Give overlapping entries separate lanes; touching endpoints do not overlap.
export function layoutEntries(entries: ReadonlyArray<TimeTrackingEntry>) {
  const sorted = [...entries].sort(
    (a, b) =>
      a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.id.localeCompare(b.id),
  );
  const result: { entry: TimeTrackingEntry; lane: number; lanes: number }[] = [];
  let group: typeof result = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const flush = () => {
    group.forEach((item) => {
      item.lanes = laneEnds.length;
    });
    result.push(...group);
    group = [];
    laneEnds = [];
  };
  for (const entry of sorted) {
    if (entry.startMinute >= groupEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= entry.startMinute);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = entry.endMinute;
    group.push({ entry, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, entry.endMinute);
  }
  flush();
  return result;
}
// Moves keep their duration, including non-quarter-hour entries, and never cross midnight.
export function movedTime(
  entry: { startMinute: number; endMinute: number },
  date: string,
  minute: number,
  snap = true,
) {
  const duration = entry.endMinute - entry.startMinute;
  const startMinute = Math.max(
    0,
    Math.min(1440 - duration, snap ? Math.round(minute / 15) * 15 : minute),
  );
  return { date, startMinute, endMinute: startMinute + duration };
}
