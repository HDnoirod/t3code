import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { PlusIcon, MessageSquarePlusIcon } from "lucide-react";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import {
  hubCreateChatCommand,
  hubListQuery,
  hubEnsureProjectCommand,
} from "../../state/workspaceHub";
import { newThreadId } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { useEnvironments } from "../../state/environments";
import { waitForThreadShell } from "../../state/entities";

export function HubChatButton({
  environmentId,
  projectId,
  clientId,
  clientName,
  disabled = false,
  workspaceId,
  sourceWorkspaceId,
  compact = false,
  onStarted,
}: {
  environmentId: EnvironmentId;
  projectId: string | null;
  clientId?: string;
  clientName?: string;
  disabled?: boolean;
  workspaceId?: ProjectId;
  sourceWorkspaceId?: ProjectId | undefined;
  compact?: boolean;
  onStarted?: () => void;
}) {
  const { environments } = useEnvironments();
  const supportsClientChats =
    environments.find((env) => env.environmentId === environmentId)?.serverConfig?.clientChats ===
    true;
  const label = clientId
    ? `New chat for ${clientName ?? "this client"}`
    : projectId === null
      ? "New free chat"
      : "New chat in this project";
  const ensure = useAtomCommand(hubEnsureProjectCommand, { reportFailure: false });
  const create = useAtomCommand(hubCreateChatCommand, { reportFailure: false });
  const index = useEnvironmentQuery(hubListQuery({ environmentId, input: { search: "" } }));
  const navigate = useNavigate();
  const pendingId = useRef<ThreadId | null>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    if (pendingId.current === null) pendingId.current = newThreadId();
    const threadId = pendingId.current;
    return await (async () => {
      let resolvedProjectId = projectId;
      if (sourceWorkspaceId) {
        const resolved = await ensure({ environmentId, input: { workspaceId: sourceWorkspaceId } });
        if (resolved._tag !== "Success") throw squashAtomCommandFailure(resolved);
        resolvedProjectId = resolved.value.id;
      }
      const result = await create({
        environmentId,
        input: {
          projectId: resolvedProjectId,
          ...(clientId ? { clientId } : {}),
          threadId,
          ...(workspaceId ? { workspaceId } : {}),
        },
      });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      await waitForThreadShell({ environmentId, threadId: result.value.threadId });
      pendingId.current = null;
      index.refresh();
      onStarted?.();
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: result.value.threadId },
      });
    })()
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not create the chat.");
      })
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  };
  return (
    <div className="hub-chat-create">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size={compact ? "icon-sm" : "sm"}
              variant={compact ? "ghost" : "default"}
              aria-label={label}
              disabled={busy || disabled || (!!clientId && !supportsClientChats)}
              onClick={() => void start()}
            />
          }
        >
          {clientId ? <MessageSquarePlusIcon /> : <PlusIcon />}
          {!compact && (busy ? "Creating…" : "New chat")}
        </TooltipTrigger>
        <TooltipPopup>
          {clientId && !supportsClientChats
            ? "Update T3 on this computer to start client chats"
            : label}
        </TooltipPopup>
      </Tooltip>
      {error && (
        <p className="hub-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
