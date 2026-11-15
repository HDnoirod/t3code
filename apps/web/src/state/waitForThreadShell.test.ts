import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";

const { shellAtoms } = await vi.hoisted(async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    shellAtoms: Atom.family((key: string) =>
      Atom.make<ReturnType<typeof thread> | null>(null).pipe(Atom.withLabel(key)),
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

const thread = (id: string, environment = "mac") => ({
  id: ThreadId.make(id),
  environmentId: EnvironmentId.make(environment),
});

const refFor = (value: ReturnType<typeof thread>): ScopedThreadRef => ({
  environmentId: value.environmentId,
  threadId: value.id,
});
const publish = (value: ReturnType<typeof thread>) =>
  appAtomRegistry.set(shellAtoms(JSON.stringify(refFor(value))), value);
afterEach(() => vi.useRealTimers());

describe("waiting for a created chat to reach the client", () => {
  it("opens an already synchronized chat without adding a subscription or timeout", async () => {
    vi.useFakeTimers();
    const value = thread("already-synced");
    publish(value);
    const timers = vi.getTimerCount();
    expect(await waitForThreadShell(refFor(value))).toBe(true);
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
    expect(await waiting).toBe(true);
  });
  it("reports a stalled sync and releases its subscription so the same chat can be retried", async () => {
    vi.useFakeTimers();
    const value = thread("retry");
    const waiting = waitForThreadShell(refFor(value), 100);
    const rejected = expect(waiting).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    publish(value);
    expect(await waitForThreadShell(refFor(value))).toBe(true);
  });
});
