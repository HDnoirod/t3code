import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  clientChatWorkspaceId,
  FREE_CHAT_WORKSPACE_ID,
  type HubSummary,
} from "@t3tools/contracts";
import { newHubItem } from "./hub";
import { buildWorkspaceOverview } from "./workspaceOverview.logic";
import type { NavigationProject, NavigationClient } from "./projectNavigation";

const environmentId = EnvironmentId.make("mac");
const remote = EnvironmentId.make("remote");
const record = (
  id: string,
  kind: HubSummary["kind"],
  extra: Partial<HubSummary> = {},
): HubSummary => ({
  ...newHubItem(kind),
  id,
  title: id,
  aiContext: false,
  chatIds: [],
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
  ...extra,
});
const project = (id: string, extra: Partial<NavigationProject> = {}): NavigationProject => ({
  ...record(id, "project"),
  environmentId,
  ...extra,
});
const client = (id: string, extra: Partial<NavigationClient> = {}): NavigationClient => ({
  id,
  name: id,
  environmentId,
  archived: false,
  ...extra,
});
const chat = (id: string, projectId = ProjectId.make("folder"), env = environmentId) => ({
  id: ThreadId.make(id),
  projectId,
  environmentId: env,
  title: id,
  archivedAt: null,
  updatedAt: "2026-11-02",
});
const input = { environmentId, query: "", projects: [], clients: [], threads: [], records: [] };

describe("work overview", () => {
  it("keeps client chats, project chats and personal chats in their correct homes", () => {
    const data = buildWorkspaceOverview({
      ...input,
      clientId: "customer",
      clients: [client("customer")],
      projects: [project("HumanOS", { clientIds: ["customer"], workspaceIds: ["folder"] })],
      threads: [
        chat("project chat"),
        chat("client chat", clientChatWorkspaceId("customer")),
        chat("personal", FREE_CHAT_WORKSPACE_ID),
        chat("elsewhere", clientChatWorkspaceId("other")),
      ],
    });
    expect(data.chats.map(({ thread, direct, context }) => [thread.id, direct, context])).toEqual([
      ["project chat", false, "customer / HumanOS"],
      ["client chat", true, "customer"],
    ]);
    expect(data.projects.map((value) => value.id)).toEqual(["HumanOS"]);
  });
  it("searches a client's name across its projects and chats, ignoring accents", () => {
    const data = buildWorkspaceOverview({
      ...input,
      query: "QUEBEC",
      clients: [client("customer", { name: "Québec Inc." })],
      projects: [project("Portal", { clientIds: ["customer"], workspaceIds: ["folder"] })],
      threads: [chat("Deployment")],
    });
    expect(data.clients).toHaveLength(1);
    expect(data.projects).toHaveLength(1);
    expect(data.chats).toHaveLength(1);
  });
  it("includes content search hits without leaking another client's notes or archived records", () => {
    const records = [
      record("project", "project", { clientIds: ["a"] }),
      record("note", "note", { projectIds: ["project"] }),
      record("other", "note", { clientIds: ["b"] }),
      record("archived", "note", { clientIds: ["a"], archived: true }),
    ];
    const data = buildWorkspaceOverview({
      ...input,
      clientId: "a",
      query: "phrase from body",
      records,
      contentMatches: ["note", "other", "archived"],
    });
    expect(data.records.map((value) => value.id)).toEqual(["note"]);
  });
  it("keeps identical ids on different computers independent", () => {
    const data = buildWorkspaceOverview({
      ...input,
      clients: [
        client("client"),
        client("client", { environmentId: remote, name: "Remote client" }),
      ],
      projects: [
        project("local", { workspaceIds: ["folder"], clientIds: ["client"] }),
        project("remote", { environmentId: remote, workspaceIds: ["folder"] }),
      ],
      threads: [chat("chat"), chat("chat", ProjectId.make("folder"), remote)],
    });
    expect(data.projects.map((value) => value.id)).toEqual(["local"]);
    expect(data.clients.map((value) => value.name)).toEqual(["client"]);
    expect(data.chats.map((value) => value.context)).toEqual(["client / local"]);
  });
  it("keeps a shared conversation unique and hides archived chats", () => {
    const data = buildWorkspaceOverview({
      ...input,
      projects: [project("a", { chatIds: ["shared"] }), project("b", { chatIds: ["shared"] })],
      threads: [chat("shared"), { ...chat("old"), archivedAt: "2026-11-02" }],
    });
    expect(data.chats.map((value) => value.context)).toEqual(["a"]);
  });
});
