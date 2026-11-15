import { clientIdForChatWorkspace, type ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  groupProjectsByClient,
  type NavigationProject,
  type NavigationClient,
} from "./projectNavigation";

type SidebarThread = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "projectId" | "title" | "updatedAt" | "pinnedAt" | "archivedAt"
>;

export function buildProjectSidebarRows<T extends SidebarThread>({
  projects,
  clients,
  threads,
  owners,
  search,
  collapsed,
  collapsedClients,
  expanded,
  active,
}: {
  projects: readonly NavigationProject[];
  clients: readonly NavigationClient[];
  threads: readonly T[];
  owners: ReadonlyMap<string, NavigationProject>;
  search: string;
  collapsed: readonly string[];
  collapsedClients: readonly string[];
  expanded: readonly string[];
  active: ScopedThreadRef | null;
}) {
  const byProject = new Map<string, T[]>();
  const byClient = new Map<string, T[]>();
  const other: T[] = [];
  for (const thread of threads) {
    if (thread.archivedAt) continue;
    const clientId = clientIdForChatWorkspace(thread.projectId);
    if (clientId !== null) {
      const key = `${thread.environmentId}:client:${clientId}`;
      const list = byClient.get(key) ?? [];
      list.push(thread);
      byClient.set(key, list);
      continue;
    }
    const owner = owners.get(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)));
    if (!owner) {
      other.push(thread);
      continue;
    }
    const key = `${owner.environmentId}:${owner.id}`;
    const list = byProject.get(key) ?? [];
    list.push(thread);
    byProject.set(key, list);
  }
  const hierarchy = groupProjectsByClient(projects, clients, new Set(byClient.keys()));
  for (const [key, chats] of byClient) {
    if (hierarchy.some((client) => client.key === key)) continue;
    const thread = chats[0]!;
    hierarchy.push({
      key,
      environmentId: thread.environmentId,
      clientId: clientIdForChatWorkspace(thread.projectId),
      title: "Client unavailable",
      archived: true,
      projects: [],
    });
  }
  const term = search.trim().toLocaleLowerCase();
  const parentByProject = new Map<string, (typeof hierarchy)[number]>(
    hierarchy.flatMap((client) =>
      client.projects.map((project) => [`${project.environmentId}:${project.id}`, client] as const),
    ),
  );
  const groups = projects
    .toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || a.title.localeCompare(b.title))
    .flatMap((project) => {
      const key = `${project.environmentId}:${project.id}`;
      const all = (byProject.get(key) ?? []).sort(
        (a, b) =>
          Number(b.pinnedAt != null) - Number(a.pinnedAt != null) ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
      const parentMatches = parentByProject.get(key)?.title.toLocaleLowerCase().includes(term);
      const matching =
        !term || parentMatches || project.title.toLocaleLowerCase().includes(term)
          ? all
          : all.filter((thread) => thread.title.toLocaleLowerCase().includes(term));
      if (
        term &&
        !parentMatches &&
        !matching.length &&
        !project.title.toLocaleLowerCase().includes(term)
      )
        return [];
      const open = !!term || !collapsed.includes(key);
      const visible =
        term || expanded.includes(key)
          ? matching
          : matching.filter(
              (thread, i) =>
                i < 5 ||
                (thread.id === active?.threadId && thread.environmentId === active?.environmentId),
            );
      return [
        {
          key,
          project,
          open,
          visible: open ? visible : [],
          more: matching.length > visible.length,
        },
      ];
    });
  const groupByKey = new Map(groups.map((group) => [group.key, group]));
  const rows = {
    groups,
    clients: hierarchy.flatMap((client) => {
      const children = client.projects.flatMap((project) => {
        const group = groupByKey.get(`${project.environmentId}:${project.id}`);
        return group ? [group] : [];
      });
      const chats = (byClient.get(client.key) ?? [])
        .filter(
          (thread) =>
            !term ||
            client.title.toLocaleLowerCase().includes(term) ||
            thread.title.toLocaleLowerCase().includes(term),
        )
        .sort(
          (a, b) =>
            Number(b.pinnedAt != null) - Number(a.pinnedAt != null) ||
            b.updatedAt.localeCompare(a.updatedAt),
        );
      const visibleChats = chats.filter(
        (thread, i) =>
          term ||
          expanded.includes(client.key) ||
          i < 5 ||
          (thread.id === active?.threadId && thread.environmentId === active?.environmentId),
      );
      if (
        term &&
        !children.length &&
        !chats.length &&
        !client.title.toLocaleLowerCase().includes(term)
      )
        return [];
      return [
        {
          ...client,
          groups: children,
          chats: visibleChats,
          moreChats: chats.length > visibleChats.length,
          open: !!term || !collapsedClients.includes(client.key),
        },
      ];
    }),
    other: other
      .filter((thread) => !term || thread.title.toLocaleLowerCase().includes(term))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
  const freeOpen = !!search.trim() || !collapsedClients.includes("free");
  const freeVisible = rows.other.filter(
    (thread, index) =>
      search.trim() ||
      expanded.includes("free") ||
      index < 5 ||
      (thread.id === active?.threadId && thread.environmentId === active?.environmentId),
  );
  return {
    ...rows,
    freeOpen,
    freeVisible,
    visibleThreads: [
      ...rows.clients
        .filter((client) => client.open)
        .flatMap((client) => [...client.chats, ...client.groups.flatMap((group) => group.visible)]),
      ...(freeOpen ? freeVisible : []),
    ],
  };
}
