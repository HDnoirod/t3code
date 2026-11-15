import { useCallback, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  FREE_CHAT_WORKSPACE_ID,
  clientIdForChatWorkspace,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useHandleNewThread as useFolderChatHandler } from "./useHandleNewThread";
import type { NavigationProject } from "../components/workspaceHub/projectNavigation";
import { useHubProjects } from "../components/workspaceHub/useHubProjects";
import { hubCreateChatCommand, hubListQuery, hubEnsureProjectCommand } from "../state/workspaceHub";
import { useAtomCommand } from "../state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { toastManager } from "../components/ui/toast";
import { newThreadId } from "../lib/utils";
import { useEnvironments } from "../state/environments";
import { waitForThreadShell } from "../state/entities";

export function useProjectChatHandler() {
  const context = useFolderChatHandler();
  const { activeThread, routeThreadRef, handleNewThread: createDraft } = context;
  const { owners } = useHubProjects();
  const { environments } = useEnvironments();
  const activeClientId = activeThread ? clientIdForChatWorkspace(activeThread.projectId) : null;
  const activeHubProject = routeThreadRef ? owners.get(scopedThreadKey(routeThreadRef)) : undefined;
  const ensure = useAtomCommand(hubEnsureProjectCommand, { reportFailure: false });
  const createHubChat = useAtomCommand(hubCreateChatCommand, { reportFailure: false });
  const router = useRouter();
  const pending = useRef<{ key: string; id: ThreadId } | null>(null);
  const creating = useRef(false);
  const handleProjectChat = useCallback(
    async (
      hub:
        | NavigationProject
        | { id: null; clientId?: string; environmentId: EnvironmentId; sourceWorkspaceId?: never },
    ) => {
      if (creating.current) return null;
      creating.current = true;
      const clientId = "clientId" in hub ? hub.clientId : undefined;
      const key = `${hub.environmentId}:${clientId ? `client:${clientId}` : hub.id}`;
      if (pending.current?.key !== key) pending.current = { key, id: newThreadId() };
      try {
        if (
          clientId &&
          !environments.find((env) => env.environmentId === hub.environmentId)?.serverConfig
            ?.clientChats
        )
          throw new Error("Update T3 on this computer to start chats directly under a client.");
        let projectId = hub.id;
        if (hub.sourceWorkspaceId) {
          const resolved = await ensure({
            environmentId: hub.environmentId,
            input: { workspaceId: hub.sourceWorkspaceId },
          });
          if (resolved._tag !== "Success") throw squashAtomCommandFailure(resolved);
          projectId = resolved.value.id;
        }
        const result = await createHubChat({
          environmentId: hub.environmentId,
          input: {
            projectId,
            ...(clientId ? { clientId } : {}),
            threadId: pending.current.id,
          },
        });
        if (result._tag !== "Success") throw squashAtomCommandFailure(result);
        await waitForThreadShell({
          environmentId: hub.environmentId,
          threadId: result.value.threadId,
        });
        pending.current = null;
        appAtomRegistry.refresh(
          hubListQuery({ environmentId: hub.environmentId, input: { search: "" } }),
        );
        await router.navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: hub.environmentId, threadId: result.value.threadId },
        });
        return null;
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not create chat",
          description: error instanceof Error ? error.message : "Try again.",
        });
        return null;
      } finally {
        creating.current = false;
      }
    },
    [createHubChat, ensure, router, environments],
  );
  const handleFreeChat = useCallback(
    (environmentId: EnvironmentId) => handleProjectChat({ environmentId, id: null }),
    [handleProjectChat],
  );
  const handleClientChat = useCallback(
    (environmentId: EnvironmentId, clientId: string) =>
      handleProjectChat({ environmentId, id: null, clientId }),
    [handleProjectChat],
  );
  const handleNewThread = useCallback(
    async (...args: Parameters<typeof createDraft>) => {
      const [projectRef, options] = args;
      const clientId = clientIdForChatWorkspace(projectRef.projectId);
      if (clientId && !options?.branch && !options?.worktreePath)
        return handleClientChat(projectRef.environmentId, clientId);
      const hub =
        routeThreadRef &&
        activeThread?.projectId === projectRef.projectId &&
        routeThreadRef.environmentId === projectRef.environmentId &&
        !options?.worktreePath &&
        !options?.branch &&
        !options?.envMode &&
        !options?.startFromOrigin
          ? activeHubProject
          : undefined;
      if (hub) return handleProjectChat(hub);
      if (
        projectRef.projectId === FREE_CHAT_WORKSPACE_ID &&
        !options?.branch &&
        !options?.worktreePath
      )
        return handleFreeChat(projectRef.environmentId);
      return createDraft(...args);
    },
    [
      createDraft,
      activeHubProject,
      activeThread?.projectId,
      routeThreadRef,
      handleProjectChat,
      handleFreeChat,
      handleClientChat,
    ],
  );
  return {
    ...context,
    activeHubProject,
    activeClientId,
    handleNewThread,
    handleProjectChat,
    handleFreeChat,
    handleClientChat,
  };
}
