import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

const { shellAtoms } = await vi.hoisted(async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return {
    shellAtoms: Atom.family((key: string) =>
      Atom.make<EnvironmentThreadShell | null>(null).pipe(Atom.withLabel(key)),
    ),
  };
});
vi.mock("./threads", () => ({
  environmentThreadShells: {
    threadShellAtom: (ref: ScopedThreadRef) => shellAtoms(JSON.stringify(ref)),
  },
}));
import { appAtomRegistry } from "../rpc/atomRegistry";
import { waitForThreadShell } from "./entities";

const thread = (id: string, environment = "mac"): EnvironmentThreadShell => ({
  id: ThreadId.make(id),
  environmentId: EnvironmentId.make(environment),
  projectId: ProjectId.make("folder"),
  title: "New thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-11-12T00:00:00.000Z",
  updatedAt: "2026-11-12T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  pullRequests: [],
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
});
const refFor = (value: EnvironmentThreadShell): ScopedThreadRef => ({
  environmentId: value.environmentId,
  threadId: value.id,
});
const publish = (value: EnvironmentThreadShell) =>
  appAtomRegistry.set(shellAtoms(JSON.stringify(refFor(value))), value);
afterEach(() => vi.useRealTimers());

describe("waiting for a created chat to reach the client", () => {
  it("opens an already synchronized chat without adding a subscription or timeout", async () => {
    vi.useFakeTimers();
    const value = thread("already-synced");
    publish(value);
    const timers = vi.getTimerCount();
    expect(await waitForThreadShell(refFor(value))).toBe(value);
    expect(vi.getTimerCount()).toBe(timers);
  });
  it("waits for the requested chat event, ignoring the same id on another computer", async () => {
    const value = thread("delayed");
    let resolved = false;
    const waiting = waitForThreadShell(refFor(value)).then((result) => {
      resolved = true;
      return result;
    });
    publish(thread("delayed", "remote"));
    await Promise.resolve();
    expect(resolved).toBe(false);
    publish(value);
    expect(await waiting).toBe(value);
  });
  it("reports a stalled sync and releases its subscription so the same chat can be retried", async () => {
    vi.useFakeTimers();
    const value = thread("retry");
    const waiting = waitForThreadShell(refFor(value), 100);
    const rejected = expect(waiting).rejects.toThrow("The chat was created but has not synced yet");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    publish(value);
    expect(await waitForThreadShell(refFor(value))).toBe(value);
  });
});
