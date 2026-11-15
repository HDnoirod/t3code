import { act, useLayoutEffect, type PointerEvent, type MouseEvent } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { TimeTrackingEntry } from "@t3tools/contracts";
import { useTimeEntryMove } from "./useTimeEntryMove";

let renderer: ReactTestRenderer;
let result: ReturnType<typeof useTimeEntryMove>;
let events: EventTarget;
const onMove = vi.fn();
const onEdit = vi.fn();
const day = { dataset: { timeDate: "2026-11-08" }, getBoundingClientRect: () => ({ top: 0 }) };
const elementFromPoint = vi.fn((): { closest: () => typeof day } | null => ({
  closest: () => day,
}));
const root = { current: { contains: (element: unknown) => element === day } as HTMLDivElement };
const button = { setPointerCapture: vi.fn(), getBoundingClientRect: () => ({ top: 560 }) };
const entry: TimeTrackingEntry = {
  id: "a",
  clientId: "client",
  date: "2026-11-07",
  startMinute: 600,
  endMinute: 720,
  task: "Work",
  notes: "",
  version: 1,
  hourlyRateCents: 10000,
  currency: "CAD",
};
function pointer(y = 588, x = 100, pointerType = "mouse") {
  return {
    button: 0,
    pointerId: 1,
    isPrimary: true,
    pointerType,
    clientX: x,
    clientY: y,
    currentTarget: button,
    preventDefault() {},
  } as unknown as PointerEvent<HTMLButtonElement>;
}
function click(detail = 1) {
  return { detail, preventDefault() {} } as MouseEvent<HTMLButtonElement>;
}
function Fixture({ mode = "week", busy = false }: { mode?: "week" | "month"; busy?: boolean }) {
  const move = useTimeEntryMove({ root, mode, busy, onMove, onEdit });
  useLayoutEffect(() => {
    result = move;
  });
  return null;
}
beforeEach(async () => {
  events = new EventTarget();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  vi.stubGlobal("document", { elementFromPoint });
  elementFromPoint.mockReturnValue({ closest: () => day });
  await act(() => {
    renderer = create(<Fixture />);
  });
});
afterEach(async () => {
  await act(() => renderer.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("moving time blocks", () => {
  it("keeps a click as edit when pointer movement is below the drag threshold", async () => {
    await act(() => {
      const props = result.entryProps(entry);
      props.onPointerDown!(pointer());
      props.onPointerMove!(pointer(590));
      props.onPointerUp!(pointer(590));
      props.onClick!(click());
    });
    expect(onEdit).toHaveBeenCalledWith(entry);
    expect(onMove).not.toHaveBeenCalled();
    expect(result.preview).toBeNull();
  });
  it("previews a snapped move using the grab offset and saves the final release position once", async () => {
    await act(() => result.entryProps(entry).onPointerDown!(pointer()));
    await act(() => result.entryProps(entry).onPointerMove!(pointer(700, 200)));
    expect(result.preview).toEqual({
      id: "a",
      date: "2026-11-08",
      startMinute: 720,
      endMinute: 840,
    });
    await act(() => {
      result.entryProps(entry).onPointerUp!(pointer(756, 200));
      result.entryProps(entry).onLostPointerCapture!(pointer(756, 200));
      result.entryProps(entry).onClick!(click());
    });
    expect(onMove).toHaveBeenCalledExactlyOnceWith(entry, "2026-11-08", 780);
    expect(onEdit).not.toHaveBeenCalled();
    expect(result.preview).toBeNull();
    await act(() => result.entryProps(entry).onClick!(click(0)));
    expect(onEdit).toHaveBeenCalledWith(entry);
  });
  it("handles a quick drag with no intermediate pointermove event", async () => {
    await act(() => {
      result.entryProps(entry).onPointerDown!(pointer());
      result.entryProps(entry).onPointerUp!(pointer(700, 200));
      result.entryProps(entry).onClick!(click());
    });
    expect(onMove).toHaveBeenCalledExactlyOnceWith(entry, "2026-11-08", 720);
    expect(onEdit).not.toHaveBeenCalled();
  });
  it.each(["Escape", "blur", "cancel", "lost capture", "outside"])(
    "cancels without a save or stray editor after %s",
    async (reason) => {
      await act(() => {
        result.entryProps(entry).onPointerDown!(pointer());
        result.entryProps(entry).onPointerMove!(pointer(700, 200));
      });
      await act(() => {
        if (reason === "Escape")
          events.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
        if (reason === "blur") events.dispatchEvent(new Event("blur"));
        if (reason === "cancel") result.entryProps(entry).onPointerCancel!(pointer());
        if (reason === "lost capture") result.entryProps(entry).onLostPointerCapture!(pointer());
        if (reason === "outside") elementFromPoint.mockReturnValue(null);
        result.entryProps(entry).onPointerUp!(pointer(700, 200));
        result.entryProps(entry).onClick!(click());
      });
      expect(onMove).not.toHaveBeenCalled();
      expect(onEdit).not.toHaveBeenCalled();
      expect(result.preview).toBeNull();
    },
  );
  it("keeps the exact start time when moving a month entry to another day", async () => {
    const precise = { ...entry, startMinute: 603, endMinute: 723 };
    await act(() => renderer.update(<Fixture mode="month" />));
    await act(() => {
      result.entryProps(precise).onPointerDown!(pointer());
      result.entryProps(precise).onPointerMove!(pointer(800, 200));
      result.entryProps(precise).onPointerUp!(pointer(800, 200));
    });
    expect(onMove).toHaveBeenCalledExactlyOnceWith(precise, "2026-11-08", 603);
  });
  it("leaves touch scrolling alone and ignores moves while a save is pending", async () => {
    await act(() => {
      result.entryProps(entry).onPointerDown!(pointer(588, 100, "touch"));
      result.entryProps(entry).onPointerMove!(pointer(700, 200, "touch"));
      result.entryProps(entry).onPointerUp!(pointer(700, 200, "touch"));
    });
    await act(() => renderer.update(<Fixture busy />));
    await act(() => {
      result.entryProps(entry).onPointerDown!(pointer());
      result.entryProps(entry).onPointerUp!(pointer(700, 200));
    });
    expect(button.setPointerCapture).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });
});
