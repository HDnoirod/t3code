import type { TimeTrackingEntry } from "@t3tools/contracts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";
import { movedTime } from "./calendar";

export function useTimeEntryMove({
  root,
  mode,
  busy,
  onMove,
  onEdit,
}: {
  root: RefObject<HTMLDivElement | null>;
  mode: "week" | "month";
  busy: boolean;
  onMove: (entry: TimeTrackingEntry, date: string, startMinute: number) => void;
  onEdit: (entry: TimeTrackingEntry) => void;
}) {
  const drag = useRef<{
    entry: TimeTrackingEntry;
    x: number;
    y: number;
    offset: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<(ReturnType<typeof movedTime> & { id: string }) | null>(
    null,
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const cancel = useCallback(() => {
    if (drag.current?.moved) suppressClick.current = true;
    drag.current = null;
    setPreview(null);
    setDraggingId(null);
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
    };
  }, [cancel]);
  const targetAt = (x: number, y: number, current: NonNullable<typeof drag.current>) => {
    const day = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-time-date]");
    const date = day?.dataset.timeDate;
    if (!day || !date || !root.current?.contains(day)) return null;
    const minute =
      mode === "month"
        ? current.entry.startMinute
        : ((y - day.getBoundingClientRect().top) / 56) * 60 - current.offset;
    return { id: current.entry.id, ...movedTime(current.entry, date, minute, mode === "week") };
  };
  const entryProps = (
    entry: TimeTrackingEntry,
  ): ComponentProps<"button"> & { "data-moving": boolean } => ({
    disabled: busy,
    "data-moving": draggingId === entry.id,
    onDragStart: (event) => event.preventDefault(),
    onPointerDown: (event) => {
      suppressClick.current = false;
      if (busy || event.button !== 0 || !event.isPrimary || event.pointerType === "touch") return;
      drag.current = {
        entry,
        x: event.clientX,
        y: event.clientY,
        offset: ((event.clientY - event.currentTarget.getBoundingClientRect().top) / 56) * 60,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event) => {
      const current = drag.current;
      if (!current) return;
      if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5)
        return;
      current.moved = true;
      suppressClick.current = true;
      event.preventDefault();
      setDraggingId(entry.id);
      const next = targetAt(event.clientX, event.clientY, current);
      setPreview((previous) =>
        previous?.date === next?.date && previous?.startMinute === next?.startMinute
          ? previous
          : next,
      );
    },
    onPointerUp: (event) => {
      const current = drag.current;
      if (current && Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 5)
        current.moved = true;
      const target = current?.moved ? targetAt(event.clientX, event.clientY, current) : null;
      cancel();
      if (
        current &&
        target &&
        (target.date !== entry.date || target.startMinute !== entry.startMinute)
      ) {
        onMove(current.entry, target.date, target.startMinute);
      }
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onClick: (event) => {
      if (suppressClick.current && event.detail !== 0) {
        event.preventDefault();
        return;
      }
      onEdit(entry);
    },
  });
  return { entryProps, preview };
}
