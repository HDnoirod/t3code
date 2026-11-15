import {
  isStandaloneChatWorkspace,
  clientIdForChatWorkspace,
  ThreadId,
  type EnvironmentId,
  type HubSummary,
  type ProjectId,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

export type NavigationProject = HubSummary & {
  environmentId: EnvironmentId;
  sourceWorkspaceId?: ProjectId;
};

// A shared chat has one sidebar home. All its project links remain available in the chat.
export function projectChatOwners(
  projects: readonly NavigationProject[],
  threads: readonly { id: string; projectId: string; environmentId: EnvironmentId }[] = [],
) {
  const owners = new Map<string, NavigationProject>();
  const clientChats = new Set(
    threads
      .filter((thread) => clientIdForChatWorkspace(thread.projectId) !== null)
      .map((thread) => `${thread.environmentId}:${thread.id}`),
  );
  for (const project of projects
    .filter((item) => item.kind === "project" && !item.archived)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    for (const id of project.chatIds) {
      const key = scopedThreadKey({
        environmentId: project.environmentId,
        threadId: ThreadId.make(id),
      });
      if (!clientChats.has(`${project.environmentId}:${id}`) && !owners.has(key))
        owners.set(key, project);
    }
  }
  const ordered = projects
    .filter((item) => item.kind === "project" && !item.archived)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const thread of threads) {
    const key = scopedThreadKey({
      environmentId: thread.environmentId,
      threadId: ThreadId.make(thread.id),
    });
    if (owners.has(key)) continue;
    const owner = ordered.find(
      (project) =>
        project.environmentId === thread.environmentId &&
        !isStandaloneChatWorkspace(thread.projectId) &&
        project.workspaceIds.includes(thread.projectId) &&
        !(project.excludedChatIds ?? []).includes(thread.id),
    );
    if (owner) owners.set(key, owner);
  }
  return owners;
}

export function projectWorkingFolderIds(
  project: Pick<HubSummary, "workspaceIds" | "chatIds">,
  threads: readonly { id: string; projectId: string }[],
) {
  const byId = new Map(threads.map((thread) => [String(thread.id), thread.projectId]));
  return [
    ...new Set([
      ...project.workspaceIds.filter((id) => !isStandaloneChatWorkspace(id)),
      ...project.chatIds.flatMap((id) => {
        const folder = byId.get(id);
        return folder && !isStandaloneChatWorkspace(folder) ? [folder] : [];
      }),
    ]),
  ];
}

export function unifiedProjects(
  projects: readonly NavigationProject[],
  folders: readonly {
    id: ProjectId;
    environmentId: EnvironmentId;
    title: string;
    createdAt: string;
    updatedAt: string;
  }[],
  threads: readonly { id: string; projectId: string; environmentId: EnvironmentId }[],
): NavigationProject[] {
  const all = projects.map((project) => ({
    ...project,
    workspaceIds: projectWorkingFolderIds(
      project,
      threads.filter((thread) => thread.environmentId === project.environmentId),
    ),
  }));
  const claimed = new Set(
    all.flatMap((project) => project.workspaceIds.map((id) => `${project.environmentId}:${id}`)),
  );
  return [
    ...all.filter((project) => !project.archived),
    ...folders
      .filter(
        (folder) =>
          !isStandaloneChatWorkspace(folder.id) &&
          !claimed.has(`${folder.environmentId}:${folder.id}`),
      )
      .map((folder): NavigationProject => ({
        id: `folder:${folder.id}`,
        sourceWorkspaceId: folder.id,
        environmentId: folder.environmentId,
        kind: "project",
        title: folder.title,
        workspaceIds: [folder.id],
        chatIds: [],
        aiContext: false,
        clientIds: [],
        projectIds: [],
        threadIds: [],
        relatedIds: [],
        tags: [],
        folder: "",
        pinned: false,
        archived: false,
        status: "active",
        priority: "normal",
        dueDate: null,
        version: 1,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      })),
  ];
}

export type NavigationClient = {
  id: string;
  name: string;
  archived: boolean;
  environmentId: EnvironmentId;
};

// Existing shared projects keep all their links, with their first client as their sidebar home.
export function groupProjectsByClient(
  projects: readonly NavigationProject[],
  clients: readonly NavigationClient[],
  clientChatKeys: ReadonlySet<string> = new Set(),
) {
  const groups = new Map<
    string,
    {
      key: string;
      environmentId: EnvironmentId;
      clientId: string | null;
      title: string;
      archived: boolean;
      projects: NavigationProject[];
    }
  >();
  for (const client of clients) {
    const key = `${client.environmentId}:client:${client.id}`;
    groups.set(key, {
      key,
      environmentId: client.environmentId,
      clientId: client.id,
      title: client.name,
      archived: client.archived,
      projects: [],
    });
  }
  for (const project of projects) {
    const clientId = project.clientIds[0] ?? null;
    const key = `${project.environmentId}:${clientId ? `client:${clientId}` : "personal"}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        environmentId: project.environmentId,
        clientId,
        title: clientId ? "Client unavailable" : "Personal projects",
        archived: false,
        projects: [],
      };
      groups.set(key, group);
    }
    group.projects.push(project);
  }
  return [...groups.values()]
    .filter((group) => !group.archived || group.projects.length || clientChatKeys.has(group.key))
    .sort(
      (a, b) =>
        Number(a.clientId === null) - Number(b.clientId === null) ||
        a.title.localeCompare(b.title) ||
        a.key.localeCompare(b.key),
    )
    .map((group) => ({
      ...group,
      projects: group.projects.toSorted(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          a.title.localeCompare(b.title) ||
          a.id.localeCompare(b.id),
      ),
    }));
}
