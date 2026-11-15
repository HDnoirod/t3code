import { Link, useParams } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  ChevronRightIcon,
  FolderKanbanIcon,
  MessageSquareIcon,
  PinIcon,
  PlusIcon,
} from "lucide-react";
import { useEnvironments } from "../../state/environments";
import { useThreadShells } from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
import { HubChatButton } from "./HubChatButton";
import { useHubProjects } from "./useHubProjects";
import { useSidebar } from "../ui/sidebar";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import "./workspaceHub.css";

function HubThreadLink({
  thread,
  active,
  close,
}: {
  thread: EnvironmentThreadShell;
  active: boolean;
  close: () => void;
}) {
  const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[key]);
  const status = resolveThreadStatusPill({ thread: { ...thread, lastVisitedAt } });
  return (
    <li>
      <Link
        className="hub-sidebar-chat"
        to="/$environmentId/$threadId"
        params={{ environmentId: thread.environmentId, threadId: thread.id }}
        onClick={close}
        aria-current={active ? "page" : undefined}
      >
        <MessageSquareIcon size={12} />
        <span>{thread.title}</span>
        {status && <small className={status.colorClass}>{status.label}</small>}
      </Link>
    </li>
  );
}

export function HubSidebar({
  renderChat,
  scopedProjectKeys = null,
}: {
  renderChat?: (thread: EnvironmentThreadShell, projectTitle: string) => ReactNode;
  scopedProjectKeys?: ReadonlySet<string> | null;
}) {
  const { environments } = useEnvironments();
  const { projects, owners } = useHubProjects();
  const threads = useThreadShells();
  const params = useParams({ strict: false });
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => {
    if (isMobile) setOpenMobile(false);
  };
  const grouped = useMemo(() => {
    const groups = new Map<string, EnvironmentThreadShell[]>();
    for (const thread of threads) {
      if (
        thread.archivedAt ||
        (scopedProjectKeys && !scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`))
      )
        continue;
      const owner = owners.get(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)));
      if (!owner) continue;
      const key = `${owner.environmentId}:${owner.id}`;
      const list = groups.get(key) ?? [];
      list.push(thread);
      groups.set(key, list);
    }
    for (const list of groups.values())
      list.sort(
        (a, b) =>
          Number(b.pinnedAt != null) - Number(a.pinnedAt != null) ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
    return groups;
  }, [threads, owners, scopedProjectKeys]);
  return (
    <section className="hub-sidebar" aria-label="Projects">
      <div className="hub-sidebar-heading">
        <strong>Projects</strong>
        <div className="hub-actions">
          <Link to="/hub" onClick={close}>
            Manage
          </Link>
          <Link
            to="/hub"
            search={{ create: true }}
            aria-label="New project"
            title="New project"
            onClick={close}
          >
            <PlusIcon size={15} />
          </Link>
        </div>
      </div>
      {projects
        .toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || a.title.localeCompare(b.title))
        .map((project) => {
          const chats = grouped.get(`${project.environmentId}:${project.id}`) ?? [];
          if (
            scopedProjectKeys &&
            !chats.length &&
            !project.workspaceIds.some((id) =>
              scopedProjectKeys.has(`${project.environmentId}:${id}`),
            )
          )
            return null;
          const active =
            params.environmentId === project.environmentId &&
            chats.some((chat) => chat.id === params.threadId);
          return (
            <details
              key={`${project.environmentId}:${project.id}`}
              className="hub-sidebar-project"
              open={active || undefined}
            >
              <summary>
                <ChevronRightIcon size={13} />
                <FolderKanbanIcon size={14} />
                <span>{project.title}</span>
                {project.pinned && <PinIcon size={11} />}
              </summary>
              {environments.length > 1 && (
                <p className="hub-sidebar-environment">
                  {environments.find((env) => env.environmentId === project.environmentId)?.label}
                </p>
              )}
              <div className="hub-sidebar-project-tools">
                <Link
                  to="/hub"
                  search={{ environment: project.environmentId, item: project.id }}
                  onClick={close}
                >
                  Overview & notes
                </Link>
                <HubChatButton
                  environmentId={project.environmentId}
                  projectId={project.id}
                  compact
                />
              </div>
              <ul className="hub-sidebar-chats">
                {chats.map((chat) =>
                  renderChat ? (
                    renderChat(chat, project.title)
                  ) : (
                    <HubThreadLink
                      key={chat.id}
                      thread={chat}
                      active={active && chat.id === params.threadId}
                      close={close}
                    />
                  ),
                )}
              </ul>
              {!chats.length && (
                <p className="hub-sidebar-empty">
                  Start a chat here, or open Overview & notes for shared chats.
                </p>
              )}
            </details>
          );
        })}
    </section>
  );
}
