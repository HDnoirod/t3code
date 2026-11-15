import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, HubError } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { newHubItem } from "./hub";
import type { NavigationProject } from "./projectNavigation";
import type { ProjectMoveTarget } from "./projectMove";
import { useMoveProject } from "./useMoveProject";

const mocks = vi.hoisted(() => ({ ensure: vi.fn(), save: vi.fn(), refresh: vi.fn() }));
vi.mock("../../state/workspaceHub", () => ({
  hubEnsureProjectCommand: "ensure",
  hubMoveProjectCommand: "save",
  hubListQuery: (input: unknown) => ({ query: "list", input }),
  hubItemQuery: (input: unknown) => ({ query: "item", input }),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "ensure" ? mocks.ensure : mocks.save),
}));
vi.mock("../../rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: mocks.refresh } }));

const environmentId = EnvironmentId.make("mac");
const project: NavigationProject = {
  ...newHubItem("project"),
  id: "project",
  title: "HumanOS",
  clientIds: ["alpha"],
  chatIds: ["chat"],
  aiContext: false,
  environmentId,
  version: 2,
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
};
const target: ProjectMoveTarget = {
  environmentId,
  clientId: "beta",
  title: "Beta",
  archived: false,
};
let renderer: ReactTestRenderer;
let result: ReturnType<typeof useMoveProject>;
function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Fixture() {
  const move = useMoveProject();
  useLayoutEffect(() => {
    result = move;
  });
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.save.mockResolvedValue(
    AsyncResult.success({ ...project, clientIds: ["beta"], version: 3 }),
  );
  await act(() => {
    renderer = create(<Fixture />);
  });
});
afterEach(async () => {
  await act(() => renderer.unmount());
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("moving a sidebar project", () => {
  it("waits for persistence, prevents duplicate drops and refreshes both views after success", async () => {
    const pending = deferred<ReturnType<typeof AsyncResult.success<NavigationProject>>>();
    mocks.save.mockReturnValueOnce(pending.promise);
    let moving: Promise<boolean>;
    await act(() => {
      moving = result.move(project, target);
    });
    expect(result.movingKey).toBe("mac:project");
    expect(result.notice).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => {
      expect(await result.move(project, target)).toBe(false);
    });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { id: "project", version: 2, clientId: "beta" },
    });
    await act(async () => {
      pending.resolve(AsyncResult.success(project));
      expect(await moving).toBe(true);
    });
    expect(result.movingKey).toBeNull();
    expect(result.notice).toEqual({ text: "Moved HumanOS to Beta.", error: false });
    expect(mocks.refresh.mock.calls).toEqual([
      [{ query: "list", input: { environmentId, input: { search: "" } } }],
      [{ query: "item", input: { environmentId, input: { id: "project" } } }],
    ]);
    expect(project.clientIds).toEqual(["alpha"]);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("shows a failed save, reloads stale state and allows a retry with the latest version", async () => {
    mocks.save.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new HubError({ message: "Changed on another device" }))),
    );
    await act(async () => {
      expect(await result.move(project, target)).toBe(false);
    });
    expect(result.notice).toEqual({ text: "Changed on another device", error: true });
    expect(result.movingKey).toBeNull();
    expect(project.clientIds).toEqual(["alpha"]);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    await act(async () => {
      expect(await result.move({ ...project, version: 4 }, target)).toBe(true);
    });
    expect(mocks.save).toHaveBeenLastCalledWith({
      environmentId,
      input: { id: "project", version: 4, clientId: "beta" },
    });
    expect(result.notice?.error).toBe(false);
  });

  it("resolves legacy folders before moving and uses the resulting project version", async () => {
    const pending = deferred<ReturnType<typeof AsyncResult.success<NavigationProject>>>();
    mocks.ensure.mockReturnValueOnce(pending.promise);
    let moving: Promise<boolean>;
    await act(() => {
      moving = result.move(
        { ...project, id: "folder:code", version: 0, sourceWorkspaceId: ProjectId.make("code") },
        target,
      );
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { workspaceId: "code" },
    });
    await act(async () => {
      pending.resolve(AsyncResult.success({ ...project, id: "resolved", version: 8 }));
      expect(await moving).toBe(true);
    });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { id: "resolved", version: 8, clientId: "beta" },
    });
    expect(mocks.refresh).toHaveBeenLastCalledWith({
      query: "item",
      input: { environmentId, input: { id: "resolved" } },
    });
  });

  it("stops a legacy move if its folder is unavailable", async () => {
    mocks.ensure.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new HubError({ message: "Folder unavailable" }))),
    );
    await act(async () => {
      expect(
        await result.move(
          { ...project, id: "folder:code", sourceWorkspaceId: ProjectId.make("code") },
          target,
        ),
      ).toBe(false);
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(result.notice?.text).toBe("Folder unavailable");
    expect(result.movingKey).toBeNull();
  });

  it.each([
    { project, target: { ...target, clientId: "alpha" } },
    { project, target: { ...target, archived: true } },
    { project, target: { ...target, environmentId: EnvironmentId.make("remote") } },
    { project: { ...project, archived: true }, target },
  ])(
    "ignores same-client, archived and cross-environment drops ($target.clientId)",
    async ({ project, target }) => {
      await act(async () => {
        expect(await result.move(project, target)).toBe(false);
      });
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.ensure).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(result.notice).toBeNull();
    },
  );

  it("supports removing the client with a drop on Personal projects", async () => {
    await act(async () => {
      expect(
        await result.move(project, { ...target, clientId: null, title: "Personal projects" }),
      ).toBe(true);
    });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { id: "project", version: 2, clientId: null },
    });
    expect(result.notice?.text).toBe("Moved HumanOS to Personal projects.");
  });
});
