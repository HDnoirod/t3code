import {
  clientIdForChatWorkspace,
  ThreadId,
  type EnvironmentId,
  type HubSummary,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { CaptureRequest } from "./hub";
import { projectChatOwners } from "./projectNavigation";

export type CaptureLocation = {
  environmentId?: string | undefined;
  pathname: string;
  itemId?: string | undefined;
  clientId?: string | undefined;
  threadId?: string | undefined;
};

// Capture uses the same single project home as the sidebar. Linking a project note
// to its client too would also share it with that client's unrelated project chats.
export function captureFiling({
  request,
  location,
  items,
  threads,
}: {
  request: CaptureRequest & { environmentId: EnvironmentId };
  location: CaptureLocation;
  items: readonly HubSummary[];
  threads: readonly { id: string; projectId: string; environmentId: EnvironmentId }[];
}): { projectIds: string[]; clientIds: string[] } {
  if (request.projectIds !== undefined || request.clientIds !== undefined)
    return { projectIds: request.projectIds ?? [], clientIds: request.clientIds ?? [] };
  const sameEnvironment = location.environmentId === request.environmentId;
  const threadId = request.threadId ?? (sameEnvironment ? location.threadId : undefined);
  if (threadId) {
    const thread = threads.find(
      (value) => value.id === threadId && value.environmentId === request.environmentId,
    );
    const clientId = thread ? clientIdForChatWorkspace(thread.projectId) : null;
    if (clientId) return { projectIds: [], clientIds: [clientId] };
    const projects = items.map((item) => ({ ...item, environmentId: request.environmentId }));
    const owner = projectChatOwners(projects, threads).get(
      scopedThreadKey({ environmentId: request.environmentId, threadId: ThreadId.make(threadId) }),
    );
    return { projectIds: owner ? [owner.id] : [], clientIds: [] };
  }
  if (sameEnvironment && location.pathname === "/hub") {
    const project = items.find(
      (item) => item.id === location.itemId && item.kind === "project" && !item.archived,
    );
    if (project) return { projectIds: [project.id], clientIds: [] };
    if (!location.itemId && location.clientId)
      return { projectIds: [], clientIds: [location.clientId] };
  }
  return { projectIds: [], clientIds: [] };
}
