import { clientIdForChatWorkspace, type EnvironmentId, type HubSummary } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  projectChatOwners,
  type NavigationClient,
  type NavigationProject,
} from "./projectNavigation";
import { belongsToClient } from "./hub";

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
type OverviewChat = Pick<
  EnvironmentThreadShell,
  "id" | "projectId" | "environmentId" | "title" | "archivedAt" | "updatedAt"
>;

export function buildWorkspaceOverview<T extends OverviewChat>({
  environmentId,
  clientId,
  query,
  projects,
  clients,
  threads,
  records,
  contentMatches = [],
}: {
  environmentId: EnvironmentId;
  clientId?: string | undefined;
  query: string;
  projects: readonly NavigationProject[];
  clients: readonly NavigationClient[];
  threads: readonly T[];
  records: readonly HubSummary[];
  contentMatches?: readonly string[];
}) {
  const term = normalize(query.trim());
  const matches = (text: string) => !term || normalize(text).includes(term);
  const localClients = clients.filter((client) => client.environmentId === environmentId);
  const localProjects = projects.filter(
    (project) => project.environmentId === environmentId && !project.archived,
  );
  const owners = projectChatOwners(localProjects, threads);
  const clientName = (id: string | null | undefined) =>
    localClients.find((client) => client.id === id)?.name ?? "";
  const scopedProjects = localProjects.filter(
    (project) => !clientId || project.clientIds[0] === clientId,
  );
  const chats = threads
    .filter((thread) => thread.environmentId === environmentId && !thread.archivedAt)
    .flatMap((thread) => {
      const owner = owners.get(scopedThreadKey(scopeThreadRef(environmentId, thread.id)));
      const directClientId = clientIdForChatWorkspace(thread.projectId);
      const parentClientId = directClientId ?? owner?.clientIds[0];
      if (clientId && parentClientId !== clientId) return [];
      const parent = directClientId
        ? clientName(directClientId) || "Client chat"
        : (owner?.title ?? "Personal chats");
      const context =
        [clientName(parentClientId), owner?.title].filter(Boolean).join(" / ") || parent;
      return matches(`${thread.title} ${context}`)
        ? [{ thread, context, direct: directClientId !== null }]
        : [];
    })
    .sort((a, b) => b.thread.updatedAt.localeCompare(a.thread.updatedAt));
  const contentIds = new Set(contentMatches);
  return {
    clients: localClients.filter(
      (client) => !client.archived && (!clientId || client.id === clientId) && matches(client.name),
    ),
    projects: scopedProjects.filter(
      (project) =>
        matches(`${project.title} ${clientName(project.clientIds[0])}`) ||
        contentIds.has(project.id),
    ),
    chats,
    records: records.filter(
      (record) =>
        record.kind !== "project" &&
        !record.archived &&
        belongsToClient(record, clientId ?? "", records) &&
        (matches(`${record.title} ${record.tags.join(" ")}`) || contentIds.has(record.id)),
    ),
  };
}
