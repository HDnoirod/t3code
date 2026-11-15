import { describe, expect, it } from "vite-plus/test";
import type { TimeTrackingReportRow } from "@t3tools/contracts";
import { calendarDate } from "./calendar";
import { parseRate, rateText, reportCsv, reportRange, summarizeReport } from "./report";

describe("time reports", () => {
  it("parses exact cents and rejects negative, fractional-cent and excessive rates", () => {
    expect(parseRate("95.35")).toBe(9535);
    expect(parseRate(" 0.1 ")).toBe(10);
    expect(parseRate("0")).toBe(0);
    expect(parseRate("1000000.00")).toBe(100000000);
    for (const invalid of ["", "-1", "1.005", "1e3", "NaN", "1000000.01"])
      expect(parseRate(invalid)).toBeNull();
    expect(rateText(null)).toBe("");
    expect(rateText(0)).toBe("0.00");
    expect(rateText(9535)).toBe("95.35");
  });
  it("selects complete Monday-Sunday weeks and actual calendar months", () => {
    expect(reportRange(calendarDate("2027-01-03"), "week")).toEqual({
      from: "2026-12-28",
      to: "2027-01-03",
    });
    expect(reportRange(calendarDate("2027-01-04"), "week")).toEqual({
      from: "2027-01-04",
      to: "2027-01-10",
    });
    expect(reportRange(calendarDate("2028-02-29"), "month")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
    expect(reportRange(calendarDate("2027-02-15"), "month").to).toBe("2027-02-28");
  });
  const rows: TimeTrackingReportRow[] = [
    {
      clientId: "a",
      currency: "CAD",
      hourlyRateCents: 10000,
      minutes: 120,
      entryCount: 1,
      amountCents: 20000,
    },
    {
      clientId: "a",
      currency: "CAD",
      hourlyRateCents: 12000,
      minutes: 60,
      entryCount: 1,
      amountCents: 12000,
    },
    {
      clientId: "b",
      currency: "USD",
      hourlyRateCents: 5000,
      minutes: 30,
      entryCount: 1,
      amountCents: 2500,
    },
    {
      clientId: "a",
      currency: "CAD",
      hourlyRateCents: null,
      minutes: 60,
      entryCount: 1,
      amountCents: null,
    },
    {
      clientId: "a",
      currency: "EUR",
      hourlyRateCents: 0,
      minutes: 15,
      entryCount: 1,
      amountCents: 0,
    },
  ];
  it("sums hours across selected clients but keeps currency amounts separate and flags unpriced time", () => {
    expect(summarizeReport(rows)).toEqual({
      minutes: 285,
      unpricedMinutes: 60,
      entryCount: 5,
      totals: [
        ["CAD", 32000],
        ["EUR", 0],
        ["USD", 2500],
      ],
    });
    expect(summarizeReport(rows.filter((row) => row.clientId === "b"))).toEqual({
      minutes: 30,
      unpricedMinutes: 0,
      entryCount: 1,
      totals: [["USD", 2500]],
    });
    expect(summarizeReport([])).toEqual({
      minutes: 0,
      unpricedMinutes: 0,
      entryCount: 0,
      totals: [],
    });
  });
  it("exports only supplied rows, protects names as text, and leaves unpriced amounts blank", () => {
    const csv = reportCsv(
      "2026-11-01",
      "2026-11-30",
      rows.filter((row) => row.clientId === "a"),
      [
        {
          id: "a",
          name: '=SUM(1,2) "client"',
          color: "#123456",
          archived: false,
          version: 1,
          hourlyRateCents: 10000,
          currency: "CAD",
        },
      ],
    );
    expect(csv.split("\r\n")).toHaveLength(5);
    expect(csv).toContain('"\'=SUM(1,2) ""client"""');
    expect(csv).not.toContain('"USD"');
    expect(csv).toContain('"CAD","","60","1.0000","1",""');
    expect(csv).toContain('"EUR","0.00","15","0.2500","1","0.00"');
  });
});
