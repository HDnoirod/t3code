import { describe, expect, it } from "vite-plus/test";
import type { HubSummary } from "@t3tools/contracts";
import { belongsToClient, newHubItem, relatedHubItems } from "./hub";
const summary = (id: string, extra: Partial<HubSummary> = {}): HubSummary => ({
  ...newHubItem("note"),
  chatIds: [],
  aiContext: false,
  id,
  title: id,
  version: 1,
  createdAt: "2026-11-03",
  updatedAt: "2026-11-03",
  ...extra,
});
describe("shared project context", () => {
  it("shows a shared note under either client without duplicating it", () => {
    const a = summary("alpha", { kind: "project", clientIds: ["one"] });
    const b = summary("beta", { kind: "project", clientIds: ["two"] });
    const note = summary("brief", { projectIds: [a.id, b.id] });
    expect(belongsToClient(note, "one", [a, b, note])).toBe(true);
    expect(belongsToClient(note, "two", [a, b, note])).toBe(true);
    expect(belongsToClient(note, "three", [a, b, note])).toBe(false);
  });
  it("shows backlinks and forward links once, including archived context", () => {
    const note = summary("note", { relatedIds: ["task"] });
    const task = summary("task", { kind: "task", archived: true, relatedIds: ["note"] });
    expect(relatedHubItems(note, [note, task])).toEqual([task]);
    expect(relatedHubItems(task, [note, task])).toEqual([note]);
  });
});
