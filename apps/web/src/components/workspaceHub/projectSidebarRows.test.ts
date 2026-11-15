import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  FREE_CHAT_WORKSPACE_ID,
  clientChatWorkspaceId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { newHubItem } from "./hub";
import { projectChatOwners, type NavigationProject } from "./projectNavigation";
import { buildProjectSidebarRows } from "./projectSidebarRows";

const environmentId = EnvironmentId.make("mac");
const project: NavigationProject = {
  ...newHubItem("project"),
  id: "y",
  title: "Project Y",
  clientIds: ["x"],
  workspaceIds: ["code"],
  chatIds: [],
  aiContext: false,
  environmentId,
  version: 1,
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
};
const client = { id: "x", name: "Client X", environmentId, archived: false };
const thread = (id: string, folder = "code", title = id) => ({
  id: ThreadId.make(id),
  projectId: ProjectId.make(folder),
  environmentId,
  title,
  pinnedAt: null,
  archivedAt: null,
  updatedAt: `2026-11-0${id === "one" ? "2" : "1"}`,
});

const threads = [
  thread("one", "code", "Design the app"),
  thread("two"),
  thread("free", FREE_CHAT_WORKSPACE_ID),
];
const base = {
  projects: [project],
  clients: [client],
  threads,
  owners: projectChatOwners([project], threads),
  search: "",
  collapsed: [],
  collapsedClients: [],
  expanded: [],
  active: null,
};

describe("client and project sidebar behavior", () => {
  it("collapses a client independently of its projects and excludes hidden chats from keyboard navigation", () => {
    const hidden = buildProjectSidebarRows({ ...base, collapsedClients: ["mac:client:x"] });
    expect(hidden.clients[0]?.open).toBe(false);
    expect(hidden.groups[0]?.open).toBe(true);
    expect(hidden.visibleThreads.map((t) => t.id)).toEqual(["free"]);
    const open = buildProjectSidebarRows(base);
    expect(open.visibleThreads.map((t) => t.id)).toEqual(["one", "two", "free"]);
  });
  it("collapses a project without collapsing the client, and can collapse free chats", () => {
    const rows = buildProjectSidebarRows({
      ...base,
      collapsed: ["mac:y"],
      collapsedClients: ["free"],
    });
    expect(rows.clients[0]?.open).toBe(true);
    expect(rows.groups[0]?.open).toBe(false);
    expect(rows.freeOpen).toBe(false);
    expect(rows.visibleThreads).toEqual([]);
  });
  it("finds client, project and chat names through collapsed branches", () => {
    for (const search of ["Client X", "Project Y", "Design"]) {
      const rows = buildProjectSidebarRows({
        ...base,
        search,
        collapsed: ["mac:y"],
        collapsedClients: ["mac:client:x"],
      });
      expect(rows.clients[0]?.open).toBe(true);
      expect(rows.groups[0]?.open).toBe(true);
      expect(rows.visibleThreads[0]?.title).toBe("Design the app");
    }
    expect(buildProjectSidebarRows({ ...base, search: "unmatched" }).clients).toEqual([]);
  });
  it("shows empty clients so their first project can be created", () => {
    const rows = buildProjectSidebarRows({ ...base, projects: [], owners: new Map() });
    expect(rows.clients[0]?.title).toBe("Client X");
    expect(rows.clients[0]?.groups).toEqual([]);
  });
  it("limits long chat lists but keeps the current chat visible until explicitly collapsed", () => {
    const many = Array.from({ length: 9 }, (_, i) => thread(`chat-${i}`));
    const input = {
      ...base,
      threads: many,
      owners: projectChatOwners([project], many),
      active: scopeThreadRef(environmentId, ThreadId.make("chat-8")),
    };
    const rows = buildProjectSidebarRows(input);
    expect(rows.groups[0]?.more).toBe(true);
    expect(rows.visibleThreads.length).toBe(6);
    expect(rows.visibleThreads.some((t) => t.id === "chat-8")).toBe(true);
    expect(buildProjectSidebarRows({ ...input, expanded: ["mac:y"] }).visibleThreads.length).toBe(
      9,
    );
  });
});

describe("chats directly under clients", () => {
  const direct = thread("direct", clientChatWorkspaceId("x"), "General planning");
  const input = { ...base, threads: [direct, ...threads] };
  it("lists client chats before projects once, with no extra project or free chat entry", () => {
    const linkedProject = { ...project, chatIds: ["direct"] };
    const rows = buildProjectSidebarRows({
      ...input,
      projects: [linkedProject],
      owners: projectChatOwners([linkedProject], input.threads),
    });
    expect(rows.clients[0]?.chats.map((chat) => chat.id)).toEqual(["direct"]);
    expect(rows.groups[0]?.visible.map((chat) => chat.id)).toEqual(["one", "two"]);
    expect(rows.visibleThreads.map((chat) => chat.id)).toEqual(["direct", "one", "two", "free"]);
    expect(rows.other.map((chat) => chat.id)).toEqual(["free"]);
  });
  it("collapses client chats with their client and finds them through collapsed parents", () => {
    expect(
      buildProjectSidebarRows({ ...input, collapsedClients: ["mac:client:x"] }).visibleThreads.map(
        (chat) => chat.id,
      ),
    ).toEqual(["free"]);
    const rows = buildProjectSidebarRows({
      ...input,
      collapsedClients: ["mac:client:x"],
      search: "General planning",
    });
    expect(rows.clients[0]?.open).toBe(true);
    expect(rows.visibleThreads.map((chat) => chat.id)).toEqual(["direct"]);
  });
  it("keeps chats accessible for archived or missing clients and separates environments", () => {
    const remote = EnvironmentId.make("remote");
    const rows = buildProjectSidebarRows({
      ...input,
      projects: [],
      clients: [{ ...client, archived: true }],
      threads: [direct, { ...direct, environmentId: remote }],
    });
    expect(rows.clients).toHaveLength(2);
    expect(
      rows.clients.map((group) => [group.environmentId, group.archived, group.chats.length]),
    ).toEqual([
      [environmentId, true, 1],
      [remote, true, 1],
    ]);
    expect(rows.other).toEqual([]);
  });
  it("limits client chats, preserves the active one and expands independently from projects", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      thread(`direct-${i}`, clientChatWorkspaceId("x")),
    );
    const input = {
      ...base,
      threads: [...many, ...threads],
      active: scopeThreadRef(environmentId, ThreadId.make("direct-8")),
    };
    const rows = buildProjectSidebarRows(input);
    expect(rows.clients[0]?.moreChats).toBe(true);
    expect(rows.clients[0]?.chats.map((chat) => chat.id)).toEqual([
      "direct-0",
      "direct-1",
      "direct-2",
      "direct-3",
      "direct-4",
      "direct-8",
    ]);
    expect(
      buildProjectSidebarRows({ ...input, expanded: ["mac:client:x"] }).clients[0]?.chats.length,
    ).toBe(9);
    const archived = buildProjectSidebarRows({
      ...input,
      threads: [{ ...direct, archivedAt: "2026-11-08" }],
    });
    expect(archived.clients[0]?.chats).toEqual([]);
  });
});
