import { describe, expect, it } from "vite-plus/test";
import {
  FREE_CHAT_WORKSPACE_ID,
  clientChatWorkspaceId,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { newHubItem } from "./hub";
import {
  groupProjectsByClient,
  unifiedProjects,
  projectChatOwners,
  projectWorkingFolderIds,
  type NavigationProject,
} from "./projectNavigation";

const environmentId = EnvironmentId.make("mac");
const project = (id: string, extra: Partial<NavigationProject> = {}): NavigationProject => ({
  ...newHubItem("project"),
  id,
  title: id,
  aiContext: false,
  chatIds: ["chat"],
  environmentId,
  version: 1,
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
  ...extra,
});
const key = (environment = environmentId) =>
  scopedThreadKey(scopeThreadRef(environment, ThreadId.make("chat")));

describe("project navigation", () => {
  it("gives a shared chat one stable home regardless of pinning or list order", () => {
    const humanOS = project("humanos");
    const shared = project("shared", { createdAt: "2026-11-02", pinned: true });
    expect(projectChatOwners([shared, humanOS]).get(key())?.id).toBe("humanos");
    expect(projectChatOwners([{ ...humanOS, pinned: false }, shared]).size).toBe(1);
    expect(shared.chatIds).toEqual(["chat"]);
  });
  it("restores unassigned chats when their last project is archived or unlinked", () => {
    expect(projectChatOwners([project("humanos", { archived: true })]).has(key())).toBe(false);
    expect(projectChatOwners([project("humanos", { chatIds: [] })]).has(key())).toBe(false);
    expect(
      projectChatOwners([project("humanos", { archived: true }), project("shared")]).get(key())?.id,
    ).toBe("shared");
  });
  it("keeps identical chat IDs on different environments independent", () => {
    const remote = EnvironmentId.make("remote");
    const owners = projectChatOwners([
      project("humanos"),
      project("other", { environmentId: remote }),
    ]);
    expect(owners.get(key())?.id).toBe("humanos");
    expect(owners.get(key(remote))?.id).toBe("other");
  });
  it("recognizes existing chats' folders and prefers the explicitly selected default", () => {
    const threads = [
      { id: "chat", projectId: "sprintsync-board" },
      { id: "other", projectId: "unrelated" },
    ];
    expect(projectWorkingFolderIds(project("humanos"), threads)).toEqual(["sprintsync-board"]);
    expect(
      projectWorkingFolderIds(
        project("humanos", { workspaceIds: ["second", "sprintsync-board"] }),
        threads,
      ),
    ).toEqual(["second", "sprintsync-board"]);
    expect(projectWorkingFolderIds(project("humanos", { chatIds: ["deleted"] }), threads)).toEqual(
      [],
    );
  });
});

const folder = (id: string, env = environmentId) => ({
  id: ProjectId.make(id),
  environmentId: env,
  title: id,
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
});

describe("one project list", () => {
  const threads = [
    { id: "chat", projectId: "code", environmentId },
    { id: "design-chat", projectId: "design", environmentId },
  ];
  it("groups several working folders under one project with no duplicate folder rows", () => {
    const projects = unifiedProjects(
      [project("HumanOS", { workspaceIds: ["design"] })],
      [folder("code"), folder("design"), folder("other")],
      threads,
    );
    expect(projects.map((item) => item.title)).toEqual(["HumanOS", "other"]);
    const owners = projectChatOwners(projects, threads);
    expect(owners.get(key())?.title).toBe("HumanOS");
    expect(
      owners.get(scopedThreadKey(scopeThreadRef(environmentId, ThreadId.make("design-chat"))))
        ?.title,
    ).toBe("HumanOS");
  });
  it("keeps old folder projects and their chats available before they are saved as projects", () => {
    const projects = unifiedProjects([], [folder("code")], threads);
    expect(projects[0]?.sourceWorkspaceId).toBe("code");
    expect(projectChatOwners(projects, threads).get(key())?.title).toBe("code");
  });
  it("does not resurrect archived projects as folder rows", () => {
    expect(
      unifiedProjects(
        [project("HumanOS", { archived: true, workspaceIds: ["design"] })],
        [folder("code"), folder("design")],
        threads,
      ),
    ).toEqual([]);
  });
  it("honors unlinking and gives explicit membership priority over a folder association", () => {
    const automatic = project("first", {
      chatIds: [],
      workspaceIds: ["code"],
      excludedChatIds: ["chat"],
    });
    expect(projectChatOwners([automatic], threads).has(key())).toBe(false);
    expect(
      projectChatOwners(
        [{ ...automatic, excludedChatIds: [] }, project("second", { createdAt: "2026-11-02" })],
        threads,
      ).get(key())?.id,
    ).toBe("second");
  });
  it("keeps folders on separate environments independent", () => {
    const remote = EnvironmentId.make("remote");
    const projects = unifiedProjects(
      [project("HumanOS", { workspaceIds: ["code"] })],
      [folder("code"), folder("code", remote)],
      threads,
    );
    expect(projects.length).toBe(2);
    expect(projects[1]?.environmentId).toBe(remote);
  });
});

describe("client hierarchy", () => {
  const clients = [
    { id: "x", name: "Client X", environmentId, archived: false },
    { id: "a", name: "Client A", environmentId, archived: false },
  ];
  it("places projects under clients and keeps unassigned projects in Personal projects", () => {
    const groups = groupProjectsByClient(
      [
        project("Y", { clientIds: ["x"] }),
        project("Z", { clientIds: ["x"] }),
        project("B", { clientIds: ["a"] }),
        project("Personal"),
      ],
      clients,
    );
    expect(groups.map((group) => [group.title, group.projects.map((item) => item.id)])).toEqual([
      ["Client A", ["B"]],
      ["Client X", ["Y", "Z"]],
      ["Personal projects", ["Personal"]],
    ]);
  });
  it("moves a project when its client changes, without copying it for shared client links", () => {
    const shared = project("Y", { clientIds: ["x", "a"] });
    expect(groupProjectsByClient([shared], clients).flatMap((group) => group.projects).length).toBe(
      1,
    );
    const moved = groupProjectsByClient([{ ...shared, clientIds: ["a"] }], clients);
    expect(moved.find((group) => group.clientId === "a")?.projects[0]?.id).toBe("Y");
    expect(moved.find((group) => group.clientId === "x")?.projects).toEqual([]);
  });
  it("keeps projects visible for archived or temporarily unavailable clients and separates environments", () => {
    const remote = EnvironmentId.make("remote");
    const groups = groupProjectsByClient(
      [
        project("local", { clientIds: ["x"] }),
        project("remote", { clientIds: ["x"], environmentId: remote }),
      ],
      [
        { ...clients[0]!, archived: true },
        { ...clients[1]!, archived: true },
      ],
    );
    expect(groups.length).toBe(2);
    expect(groups.find((group) => group.environmentId === environmentId)?.archived).toBe(true);
    expect(groups.find((group) => group.environmentId === remote)?.projects[0]?.id).toBe("remote");
  });
  it("never promotes free-chat storage to a project or inherits membership from a linked free chat", () => {
    const threads = [
      { id: "chat", projectId: FREE_CHAT_WORKSPACE_ID, environmentId },
      { id: "other", projectId: FREE_CHAT_WORKSPACE_ID, environmentId },
    ];
    expect(unifiedProjects([], [folder(FREE_CHAT_WORKSPACE_ID)], threads)).toEqual([]);
    const projects = unifiedProjects([project("Y")], [folder(FREE_CHAT_WORKSPACE_ID)], threads);
    expect(projects[0]?.workspaceIds).toEqual([]);
    const owners = projectChatOwners(projects, threads);
    expect(owners.size).toBe(1);
    expect(owners.get(key())?.id).toBe("Y");
  });
});

it("keeps a client chat under its client when linked to a project for context and hides its storage", () => {
  const workspaceId = clientChatWorkspaceId("x");
  const threads = [
    { id: "chat", projectId: workspaceId, environmentId },
    { id: "other", projectId: workspaceId, environmentId },
  ];
  expect(unifiedProjects([], [folder(workspaceId)], threads)).toEqual([]);
  const projects = unifiedProjects([project("Y")], [folder(workspaceId)], threads);
  expect(projects.map((item) => item.id)).toEqual(["Y"]);
  expect(projectWorkingFolderIds(projects[0]!, threads)).toEqual([]);
  expect(projectChatOwners(projects, threads).size).toBe(0);
});
