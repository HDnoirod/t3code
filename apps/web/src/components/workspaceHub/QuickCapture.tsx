/* oxlint-disable t3code/no-rpc-permission-bypass -- The client fields in this view identify business customers; RPC calls use permission-aware commands. */
import { useNowMinute } from "../../hooks/useNowMinute";
import { useThreadShells } from "../../state/entities";
import { lazy, Suspense, useEffect, useState } from "react";
import { useParams, useLocation, useSearch, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, HubSummary, TimeTrackingClient } from "@t3tools/contracts";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { hubListQuery } from "../../state/workspaceHub";
import { timeTrackingQuery } from "../../state/timeTracking";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { dateKey } from "../timeTracking/calendar";
const HubEditor = lazy(() =>
  import("./HubEditor").then((module) => ({ default: module.HubEditor })),
);
import { CAPTURE_EVENT, type CaptureRequest, newHubItem } from "./hub";
import { captureFiling, type CaptureLocation } from "./captureContext";

type OpenCapture = CaptureRequest & { environmentId: EnvironmentId; location: CaptureLocation };

export function QuickCaptureHost() {
  const primary = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const params = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeEnvironment = params.environmentId ?? search.environment ?? primary;
  const [request, setRequest] = useState<OpenCapture | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the capture event and keyboard listener with the current route context
  useEffect(() => {
    const open = (request: CaptureRequest) => {
      const environmentId =
        request.environmentId ??
        environments.find((environment) => environment.environmentId === routeEnvironment)
          ?.environmentId ??
        primary ??
        environments[0]?.environmentId;
      if (!environmentId) {
        toastManager.add({
          type: "error",
          title: "Connect an environment before capturing a note.",
        });
        return;
      }
      setRequest(
        (current) =>
          current ?? {
            ...request,
            environmentId,
            location: {
              environmentId: routeEnvironment ?? undefined,
              pathname,
              itemId: search.item,
              clientId: search.client,
              threadId: params.threadId,
            },
          },
      );
    };
    const onCapture = (event: Event) => open((event as CustomEvent<CaptureRequest>).detail ?? {});
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !(event.metaKey || event.ctrlKey) ||
        !event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== "j"
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      open({});
    };
    window.addEventListener(CAPTURE_EVENT, onCapture);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(CAPTURE_EVENT, onCapture);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    environments,
    primary,
    routeEnvironment,
    pathname,
    search.item,
    search.client,
    params.threadId,
  ]);
  return request ? <CaptureForm request={request} onClose={() => setRequest(null)} /> : null;
}

function CaptureForm({ request, onClose }: { request: OpenCapture; onClose: () => void }) {
  const nowMinute = useNowMinute();
  const today = dateKey(new Date(`${nowMinute}:00Z`));
  const index = useEnvironmentQuery(
    hubListQuery({ environmentId: request.environmentId, input: { search: "" } }),
  );
  const clients = useEnvironmentQuery(
    timeTrackingQuery({ environmentId: request.environmentId, input: { from: today, to: today } }),
  );
  if (!index.data || !clients.data)
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Quick capture</DialogTitle>
            <DialogDescription>
              {index.error ?? clients.error ?? "Loading your workspace…"}
            </DialogDescription>
          </DialogHeader>
          <div className="hub-editor-footer">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {(index.error || clients.error) && (
              <Button
                onClick={() => {
                  index.refresh();
                  clients.refresh();
                }}
              >
                Retry
              </Button>
            )}
          </div>
        </DialogPopup>
      </Dialog>
    );
  return (
    <Suspense
      fallback={
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
        >
          <DialogPopup finalFocus={false}>
            <DialogHeader>
              <DialogTitle>Quick capture</DialogTitle>
              <DialogDescription>Opening note editor…</DialogDescription>
            </DialogHeader>
          </DialogPopup>
        </Dialog>
      }
    >
      <CaptureEditor
        request={request}
        items={index.data.items}
        clients={clients.data.clients}
        onSaved={index.refresh}
        onClose={onClose}
      />
    </Suspense>
  );
}

function CaptureEditor({
  request,
  items,
  clients,
  onSaved,
  onClose,
}: {
  request: OpenCapture;
  items: readonly HubSummary[];
  clients: readonly TimeTrackingClient[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const threads = useThreadShells();
  const navigate = useNavigate();
  const [initial] = useState(() =>
    newHubItem("note", {
      ...captureFiling({ request, location: request.location, items, threads }),
      aiContext: request.aiContext ?? false,
      body: request.body ?? "",
      title:
        request.title ??
        (request.body
          ? (request.body
              .split("\n")
              .find((line) => line.trim())
              ?.replace(/^#+\s*/, "")
              .slice(0, 100) ?? "Saved response")
          : ""),
      threadIds: request.threadId ? [request.threadId] : [],
    }),
  );
  return (
    <HubEditor
      initial={initial}
      environmentId={request.environmentId}
      items={items}
      clients={clients}
      onClose={onClose}
      onSaved={(item) => {
        onSaved();
        toastManager.add({
          type: "success",
          title: "Note saved",
          description:
            item.projectIds.length || item.clientIds.length
              ? "Available in Notes and its linked work."
              : "Available in Notes → Inbox.",
          actionProps: {
            children: "Open note",
            onClick: () =>
              void navigate({
                to: "/notes",
                search: { environment: request.environmentId, item: item.id },
              }),
          },
        });
        onClose();
      }}
    />
  );
}
