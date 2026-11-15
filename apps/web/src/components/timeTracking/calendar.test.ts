import { describe, expect, it } from "vite-plus/test";
import {
  calendarDate,
  calendarDays,
  dateKey,
  dragRange,
  formatHours,
  layoutEntries,
  movePeriod,
  movedTime,
} from "./calendar";

describe("time tracking calendar", () => {
  it("includes weekends and crosses month and year boundaries", () => {
    expect(calendarDays(calendarDate("2027-01-01"), "week").map(dateKey)).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    expect(dateKey(movePeriod(calendarDate("2026-01-31"), "month", 1))).toBe("2026-02-01");
    expect(calendarDays(calendarDate("2026-11-01"), "month")).toHaveLength(42);
  });
  it("snaps dragging in either direction to 15 minutes and stays within a day", () => {
    expect(dragRange(600, 719)).toEqual({ startMinute: 600, endMinute: 720 });
    expect(dragRange(600, 720)).toEqual({ startMinute: 600, endMinute: 720 });
    expect(dragRange(1439, 1439)).toEqual({ startMinute: 1425, endMinute: 1440 });
    expect(dragRange(719, 600)).toEqual({ startMinute: 600, endMinute: 720 });
    expect(dragRange(-10, 1800)).toEqual({ startMinute: 0, endMinute: 1440 });
    expect(formatHours(135)).toBe("2h 15m");
  });
  it("keeps overlapping blocks clickable and uses full width after a cluster ends", () => {
    const base = {
      clientId: "client",
      date: "2026-11-07",
      task: "Work",
      notes: "",
      version: 1,
      hourlyRateCents: null,
      currency: "CAD" as const,
    };
    const result = layoutEntries([
      { ...base, id: "a", startMinute: 600, endMinute: 720 },
      { ...base, id: "b", startMinute: 660, endMinute: 780 },
      { ...base, id: "c", startMinute: 780, endMinute: 840 },
    ]);
    expect(result.map(({ lane, lanes }) => [lane, lanes])).toEqual([
      [0, 2],
      [1, 2],
      [0, 1],
    ]);
  });
  it("moves blocks between days without changing duration and clamps at midnight", () => {
    const entry = { startMinute: 600, endMinute: 733 };
    expect(movedTime(entry, "2026-11-08", 689)).toEqual({
      date: "2026-11-08",
      startMinute: 690,
      endMinute: 823,
    });
    expect(movedTime(entry, "2026-11-08", -20).startMinute).toBe(0);
    expect(movedTime(entry, "2026-11-08", 1450)).toEqual({
      date: "2026-11-08",
      startMinute: 1307,
      endMinute: 1440,
    });
    expect(movedTime({ startMinute: 0, endMinute: 1440 }, "2026-11-08", 500).startMinute).toBe(0);
    expect(
      movedTime({ startMinute: 603, endMinute: 723 }, "2026-11-08", 603, false).startMinute,
    ).toBe(603);
  });
});
