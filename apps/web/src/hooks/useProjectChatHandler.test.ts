import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  FREE_CHAT_WORKSPACE_ID,
  clientChatWorkspaceId,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { newHubItem } from "../components/workspaceHub/hub";

const state = vi.hoisted(() => ({
  draft: vi.fn(async () => ({ draftId: "draft", threadId: "new" })),
  create: vi.fn(),
  ensure: vi.fn(),
  navigate: vi.fn(),
  refresh: vi.fn(),
  waitForShell: vi.fn(),
  toast: vi.fn(),
  owners: new Map(),
  clientChats: true,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <T>(fn: T) => fn,
  useRef: <T>(current: T) => ({ current }),
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate: state.navigate }) }));
vi.mock("./useHandleNewThread", () => ({
  useHandleNewThread: () => ({
    activeThread: { projectId: "folder" },
    routeThreadRef: { environmentId: "mac", threadId: "current" },
    handleNewThread: state.draft,
  }),
}));
vi.mock("../components/workspaceHub/useHubProjects", () => ({
  useHubProjects: () => ({ owners: state.owners }),
}));
vi.mock("../state/entities", () => ({ waitForThreadShell: state.waitForShell }));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({
    environments: [{ environmentId: "mac", serverConfig: { clientChats: state.clientChats } }],
  }),
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => (command === "ensure" ? state.ensure : state.create),
}));
vi.mock("../state/workspaceHub", () => ({
  hubCreateChatCommand: {},
  hubEnsureProjectCommand: "ensure",
  hubListQuery: () => ({}),
}));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: state.refresh } }));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: state.toast } }));

import { useProjectChatHandler } from "./useProjectChatHandler";
const environmentId = EnvironmentId.make("mac");
const folder = { environmentId, projectId: ProjectId.make("folder") };
beforeEach(() => {
  vi.clearAllMocks();
  state.waitForShell.mockReset().mockResolvedValue(true);
  state.clientChats = true;
  state.owners.clear();
  state.owners.set(scopedThreadKey(scopeThreadRef(environmentId, ThreadId.make("current"))), {
    ...newHubItem("project"),
    id: "humanos",
    environmentId,
  });
  state.create.mockResolvedValue({
    _tag: "Success",
    value: { threadId: "created", workspaceId: "folder" },
  });
});
describe("contextual project chat creation", () => {
  it("creates a member chat from the current project without leaving an unassigned draft", async () => {
    await useProjectChatHandler().handleNewThread(folder);
    expect(state.create.mock.calls[0]?.[0]).toMatchObject({
      environmentId: "mac",
      input: { projectId: "humanos" },
    });
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "mac", threadId: "created" },
    });
    expect(state.draft).not.toHaveBeenCalled();
  });
  it("preserves explicit branch and worktree creation and unrelated folder chats", async () => {
    const handler = useProjectChatHandler().handleNewThread;
    await handler(folder, { branch: "feature", worktreePath: "/tmp/feature" });
    await handler({ ...folder, projectId: ProjectId.make("unrelated") });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.draft).toHaveBeenCalledTimes(2);
    expect(state.draft.mock.calls[0]).toEqual([
      folder,
      { branch: "feature", worktreePath: "/tmp/feature" },
    ]);
  });
  it("retries a lost response with the same chat ID", async () => {
    state.create.mockRejectedValueOnce(new Error("Disconnected"));
    const handler = useProjectChatHandler().handleNewThread;
    await handler(folder);
    await handler(folder);
    expect(state.create.mock.calls[0]?.[0].input.threadId).toBe(
      state.create.mock.calls[1]?.[0].input.threadId,
    );
    expect(state.navigate).toHaveBeenCalledTimes(1);
    expect(state.toast).toHaveBeenCalledTimes(1);
  });
  it("keeps unassigned chats on the original draft flow", async () => {
    state.owners.clear();
    await useProjectChatHandler().handleNewThread(folder);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.draft).toHaveBeenCalledWith(folder);
  });
});

it("creates a chat from a folder-backed project after resolving its durable project", async () => {
  state.ensure.mockResolvedValueOnce({ _tag: "Success", value: { id: "durable" } });
  const owner = state.owners.values().next().value;
  await useProjectChatHandler().handleProjectChat({
    ...owner,
    sourceWorkspaceId: ProjectId.make("folder"),
  });
  expect(state.ensure).toHaveBeenCalledWith({ environmentId, input: { workspaceId: "folder" } });
  expect(state.create.mock.calls[0]?.[0].input.projectId).toBe("durable");
  expect(state.navigate).toHaveBeenCalledTimes(1);
});

it("starts free chats without creating a project and preserves retry IDs", async () => {
  state.create.mockRejectedValueOnce(new Error("Disconnected"));
  const handler = useProjectChatHandler();
  await handler.handleFreeChat(environmentId);
  await handler.handleFreeChat(environmentId);
  expect(state.ensure).not.toHaveBeenCalled();
  expect(state.create.mock.calls[0]?.[0].input.projectId).toBeNull();
  expect(state.create.mock.calls[0]?.[0].input.threadId).toBe(
    state.create.mock.calls[1]?.[0].input.threadId,
  );
  expect(state.navigate).toHaveBeenCalledTimes(1);
});
it("keeps another new chat in the free-chat section", async () => {
  state.owners.clear();
  await useProjectChatHandler().handleNewThread({
    environmentId,
    projectId: FREE_CHAT_WORKSPACE_ID,
  });
  expect(state.create.mock.calls[0]?.[0].input.projectId).toBeNull();
  expect(state.draft).not.toHaveBeenCalled();
});

it("starts and retries chats directly under the selected client, including the contextual shortcut", async () => {
  state.create.mockRejectedValueOnce(new Error("Disconnected"));
  const handler = useProjectChatHandler();
  await handler.handleClientChat(environmentId, "alpha");
  await handler.handleNewThread({ environmentId, projectId: clientChatWorkspaceId("alpha") });
  expect(state.create.mock.calls[0]?.[0].input).toMatchObject({
    projectId: null,
    clientId: "alpha",
  });
  expect(state.create.mock.calls[0]?.[0].input.threadId).toBe(
    state.create.mock.calls[1]?.[0].input.threadId,
  );
  expect(state.draft).not.toHaveBeenCalled();
  expect(state.ensure).not.toHaveBeenCalled();
  expect(state.navigate).toHaveBeenCalledTimes(1);
});

it("does not reuse a failed client chat ID for another client or a free chat", async () => {
  state.create.mockRejectedValue(new Error("Disconnected"));
  const handler = useProjectChatHandler();
  await handler.handleClientChat(environmentId, "alpha");
  await handler.handleClientChat(environmentId, "beta");
  await handler.handleFreeChat(environmentId);
  expect(new Set(state.create.mock.calls.map(([request]) => request.input.threadId)).size).toBe(3);
  expect(state.navigate).not.toHaveBeenCalled();
});

it("asks to update an older server instead of accidentally creating a free chat", async () => {
  state.clientChats = false;
  await useProjectChatHandler().handleClientChat(environmentId, "alpha");
  expect(state.create).not.toHaveBeenCalled();
  expect(state.draft).not.toHaveBeenCalled();
  expect(state.toast).toHaveBeenCalledWith(
    expect.objectContaining({ description: expect.stringContaining("Update T3") }),
  );
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("does not enter the new route until the chat has reached the shell", async () => {
  const subscribed = deferred();
  const shell = deferred();
  state.waitForShell.mockImplementationOnce(() => {
    subscribed.resolve();
    return shell.promise.then(() => true);
  });
  const handler = useProjectChatHandler();
  const creation = handler.handleNewThread(folder);
  await subscribed.promise;
  expect(state.navigate).not.toHaveBeenCalled();
  await handler.handleNewThread(folder);
  expect(state.create).toHaveBeenCalledTimes(1);
  shell.resolve();
  await creation;
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId: "created" },
  });
});

it("reuses the created chat when retrying a shell synchronization failure", async () => {
  state.waitForShell.mockRejectedValueOnce(new Error("Chat has not synced yet"));
  const handler = useProjectChatHandler();
  await handler.handleNewThread(folder);
  expect(state.navigate).not.toHaveBeenCalled();
  await handler.handleNewThread(folder);
  expect(state.create.mock.calls[0]?.[0].input.threadId).toBe(
    state.create.mock.calls[1]?.[0].input.threadId,
  );
  expect(state.navigate).toHaveBeenCalledTimes(1);
});
