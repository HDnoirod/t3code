import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  PinIcon,
  Building2Icon,
  MessageSquareIcon,
  UsersIcon,
  SearchIcon,
} from "lucide-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useUiStateStore } from "../../uiStateStore";
import { useThreadActionMenu } from "../../hooks/useThreadActionMenu";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useAtomCommand } from "../../state/use-atom-command";
import { threadEnvironment } from "../../state/threads";
import { primaryServerKeybindingsAtom } from "../../state/server";
import {
  resolveShortcutCommand,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../../keybindings";
import { isCommandPaletteOpen, openCommandPalette } from "../../commandPaletteBus";
import { isModelPickerOpen } from "../../modelPickerVisibility";
import { isElectron } from "../../env";
import { resolveThreadStatusPill, resolveAdjacentThreadId } from "../Sidebar.logic";
import { SidebarChromeHeader, SidebarChromeFooter } from "../sidebar/SidebarChrome";
import { SidebarContent, useSidebar } from "../ui/sidebar";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { HubChatButton } from "./HubChatButton";
import { buildProjectSidebarRows } from "./projectSidebarRows";
import { useHubClients } from "./useHubClients";
import { ProjectClientsDialog } from "./ProjectClientsDialog";
import { useHubProjects } from "./useHubProjects";
import { useMoveProject } from "./useMoveProject";
import {
  canMoveProject,
  clientGroupKey,
  projectMoveKey,
  type ProjectMoveTarget,
} from "./projectMove";
import type { NavigationProject } from "./projectNavigation";
import { useOpenProject } from "./useOpenProject";
import { useComposerDraftStore } from "../../composerDraftStore";
import "./projectSidebar.css";

const collapsedProjectsSchema = Schema.Array(Schema.String);

function ChatRow({
  thread,
  active,
  close,
  onOpenProject,
}: {
  thread: EnvironmentThreadShell;
  active: boolean;
  close: () => void;
  onOpenProject?: () => void;
}) {
  const ref = useMemo(
    () => scopeThreadRef(thread.environmentId, thread.id),
    [thread.environmentId, thread.id],
  );
  const key = scopedThreadKey(ref);
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[key]);
  const status = resolveThreadStatusPill({ thread: { ...thread, lastVisitedAt } });
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const update = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const folders = useProjects();
  const { openMenu } = useThreadActionMenu({
    threadRef: ref,
    onOpenProject,
    projectCwd:
      folders.find(
        (folder) => folder.id === thread.projectId && folder.environmentId === thread.environmentId,
      )?.workspaceRoot ?? null,
    onStartRename: () => {
      setTitle(thread.title);
      setRenaming(true);
    },
  });
  const save = async () => {
    if (!title.trim()) return;
    const result = await update({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, title: title.trim() },
    });
    if (result._tag === "Success") setRenaming(false);
    else {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not rename chat",
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
  };
  return (
    <li
      className="project-chat-row"
      data-active={active}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {renaming ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            autoFocus
            aria-label="Chat name"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setRenaming(false);
            }}
          />
        </form>
      ) : (
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId: thread.environmentId, threadId: thread.id }}
          aria-current={active ? "page" : undefined}
          onClick={close}
        >
          <Tooltip>
            <TooltipTrigger render={<span />}>{thread.title}</TooltipTrigger>
            <TooltipPopup side="right">{thread.title}</TooltipPopup>
          </Tooltip>
          {thread.pinnedAt && <PinIcon size={12} aria-label="Pinned" />}
          {status && (
            <small className={status.colorClass} aria-label={status.label}>
              {["Pending Approval", "Awaiting Input"].includes(status.label)
                ? "Needs you"
                : status.label === "Working"
                  ? "Working"
                  : "•"}
            </small>
          )}
        </Link>
      )}
      <button
        className="project-row-action"
        aria-label={`Actions for ${thread.title}`}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          openMenu({ x: bounds.right, y: bounds.bottom });
        }}
      >
        <MoreHorizontalIcon size={15} />
      </button>
    </li>
  );
}

export function ProjectSidebar() {
  const { projects, owners } = useHubProjects();
  const threads = useThreadShells();
  const clients = useHubClients();
  const { environments } = useEnvironments();
  const params = useParams({ strict: false });
  const routeSearch = useSearch({ strict: false });
  const primary = usePrimaryEnvironmentId();
  const [selectedEnvironment, setSelectedEnvironment] = useState<string | null>(null);
  const environmentId =
    environments.find(
      (env) =>
        env.environmentId ===
        (selectedEnvironment ?? params.environmentId ?? routeSearch.environment ?? primary),
    )?.environmentId ?? environments[0]?.environmentId;
  const [clientsOpen, setClientsOpen] = useState(false);
  const [collapsedClients, setCollapsedClients] = useLocalStorage(
    "t3code:collapsed-clients",
    [],
    collapsedProjectsSchema,
  );
  const navigate = useNavigate();
  const openProject = useOpenProject();
  const { move, movingKey, notice } = useMoveProject();
  const draggedRef = useRef<NavigationProject | null>(null);
  const suppressOpen = useRef(false);
  const [dragged, setDragged] = useState<NavigationProject | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const clearDrag = () => {
    draggedRef.current = null;
    setDragged(null);
    setDropTarget(null);
  };
  const dropProps = (target: ProjectMoveTarget) => ({
    "data-project-drop-target": dropTarget === clientGroupKey(target) || undefined,
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (movingKey || !canMoveProject(draggedRef.current, target)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(clientGroupKey(target));
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !event.currentTarget.contains(event.relatedTarget)
      )
        setDropTarget(null);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const project = draggedRef.current;
      if (movingKey || !project || !canMoveProject(project, target)) return;
      event.preventDefault();
      event.stopPropagation();
      clearDrag();
      void move(project, target).then((saved) => {
        if (saved)
          setCollapsedClients((current) => current.filter((key) => key !== clientGroupKey(target)));
      });
    },
  });
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => {
    if (isMobile) setOpenMobile(false);
  };
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useLocalStorage(
    "t3code:collapsed-projects",
    [],
    collapsedProjectsSchema,
  );
  const [expanded, setExpanded] = useState<string[]>([]);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const rows = useMemo(
    () =>
      buildProjectSidebarRows({
        projects,
        clients,
        threads,
        owners,
        search,
        collapsed,
        collapsedClients,
        expanded,
        active:
          params.environmentId && params.threadId
            ? scopeThreadRef(
                EnvironmentId.make(params.environmentId),
                ThreadId.make(params.threadId),
              )
            : null,
      }),
    [
      projects,
      clients,
      threads,
      owners,
      search,
      collapsed,
      collapsedClients,
      expanded,
      params.environmentId,
      params.threadId,
    ],
  );
  const { freeOpen, freeVisible, visibleThreads: visible } = rows;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen() || isModelPickerOpen())
        return;
      const command = resolveShortcutCommand(event, keybindings);
      if (command === "chat.new" && !params.threadId && !params.draftId) {
        event.preventDefault();
        openCommandPalette({ open: "new-thread-in" });
        return;
      }
      const index = threadJumpIndexFromCommand(command ?? "");
      const direction = threadTraversalDirectionFromCommand(command);
      const keys = visible.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      );
      const active = visible.find(
        (thread) => thread.id === params.threadId && thread.environmentId === params.environmentId,
      );
      const key =
        index !== null
          ? keys[index]
          : direction !== null
            ? resolveAdjacentThreadId({
                threadIds: keys,
                currentThreadId: active
                  ? scopedThreadKey(scopeThreadRef(active.environmentId, active.id))
                  : null,
                direction,
              })
            : null;
      const target = visible.find(
        (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === key,
      );
      if (!target) return;
      event.preventDefault();
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: target.environmentId, threadId: target.id },
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, keybindings, params.threadId, params.draftId, params.environmentId, navigate]);
  const renderProject = ({
    key,
    project,
    open,
    visible: chats,
    more,
  }: (typeof rows.groups)[number]) => (
    <section
      key={key}
      className="project-sidebar-group"
      aria-label={project.title}
      data-project-dragging={(dragged && projectMoveKey(dragged) === key) || undefined}
      aria-busy={movingKey === key}
    >
      <div className="project-sidebar-project">
        <button
          aria-label={`${open ? "Collapse" : "Expand"} ${project.title}`}
          aria-expanded={open}
          onClick={() =>
            setCollapsed((current) =>
              open ? [...current, key] : current.filter((id) => id !== key),
            )
          }
        >
          {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        </button>
        <button
          className="project-sidebar-name"
          data-active={
            routeSearch.item === project.id && routeSearch.environment === project.environmentId
          }
          draggable={!movingKey}
          onPointerDown={() => {
            suppressOpen.current = false;
          }}
          onKeyDown={() => {
            suppressOpen.current = false;
          }}
          onDragStart={(event) => {
            if (movingKey) {
              event.preventDefault();
              return;
            }
            suppressOpen.current = true;
            draggedRef.current = project;
            setDragged(project);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-t3-project", key);
          }}
          onDragEnd={clearDrag}
          onClick={(event) => {
            if (suppressOpen.current) {
              event.preventDefault();
              return;
            }
            close();
            void openProject(project);
          }}
        >
          <FolderIcon size={19} />
          <span>{project.title}</span>
        </button>
        <HubChatButton
          environmentId={project.environmentId}
          projectId={project.id}
          sourceWorkspaceId={project.sourceWorkspaceId}
          compact
          onStarted={close}
        />
      </div>
      {environments.length > 1 && (
        <small className="project-sidebar-environment">
          {environments.find((env) => env.environmentId === project.environmentId)?.label}
        </small>
      )}
      {open && (
        <ul className="project-sidebar-chats">
          {chats.map((thread) => (
            <ChatRow
              key={thread.id}
              thread={thread}
              onOpenProject={() => void openProject(project)}
              active={
                thread.id === params.threadId && thread.environmentId === params.environmentId
              }
              close={close}
            />
          ))}
          {more && (
            <li>
              <button
                className="project-show-more"
                onClick={() => setExpanded((current) => [...current, key])}
              >
                Show more
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent>
        <div className="project-sidebar">
          <div className="project-sidebar-shortcuts">
            <Link
              to="/hub"
              search={environmentId ? { environment: environmentId } : {}}
              onClick={close}
            >
              <FolderIcon size={16} />
              All work
            </Link>
            <Link
              to="/hub"
              search={{ search: true, ...(environmentId ? { environment: environmentId } : {}) }}
              onClick={close}
            >
              <SearchIcon size={16} />
              Search all work
            </Link>
          </div>
          <div className="project-sidebar-heading">
            <Button
              variant="ghost"
              size="sm"
              disabled={!environmentId}
              onClick={() => setClientsOpen(true)}
            >
              <UsersIcon />
              Clients
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                close();
                void navigate({
                  to: "/hub",
                  search: {
                    create: true,
                    ...(environmentId ? { environment: environmentId } : {}),
                  },
                });
              }}
            >
              <PlusIcon />
              New project
            </Button>
          </div>
          {environments.length > 1 && (
            <label className="project-sidebar-environment-choice">
              Computer
              <select
                className="hub-select"
                value={environmentId ?? ""}
                onChange={(event) => setSelectedEnvironment(event.target.value)}
              >
                {environments.map((env) => (
                  <option key={env.environmentId} value={env.environmentId}>
                    {env.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="project-sidebar-search">
            <Input
              placeholder="Filter sidebar…"
              aria-label="Filter sidebar"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <Button
                variant="ghost"
                size="sm"
                aria-label="Clear sidebar filter"
                onClick={() => setSearch("")}
              >
                Clear
              </Button>
            )}
          </div>
          {search && !rows.clients.length && !rows.freeVisible.length && (
            <p className="project-sidebar-empty">
              No sidebar matches. Try Search all work to include note content.
            </p>
          )}
          <div className="project-sidebar-tree-heading">
            <span>Clients & projects</span>
            <button
              onClick={() => {
                const collapse =
                  rows.clients.some((client) => client.open) ||
                  rows.groups.some((group) => group.open);
                setCollapsedClients(collapse ? rows.clients.map((client) => client.key) : []);
                setCollapsed(collapse ? rows.groups.map((group) => group.key) : []);
              }}
            >
              {rows.clients.some((client) => client.open) || rows.groups.some((group) => group.open)
                ? "Collapse all"
                : "Expand all"}
            </button>
          </div>
          {movingKey && (
            <p className="project-move-notice" role="status">
              Moving project…
            </p>
          )}
          {!movingKey && notice && (
            <p
              className="project-move-notice"
              data-error={notice.error}
              role={notice.error ? "alert" : "status"}
            >
              {notice.text}
            </p>
          )}
          {rows.clients.map((client) => (
            <section
              className="project-client-group"
              key={client.key}
              aria-label={client.title}
              {...dropProps(client)}
            >
              <div className="project-client-heading">
                <button
                  className="project-client-chevron"
                  aria-expanded={client.open}
                  aria-label={`${client.open ? "Collapse" : "Expand"} ${client.title}`}
                  onClick={() =>
                    setCollapsedClients((current) =>
                      client.open
                        ? [...current, client.key]
                        : current.filter((key) => key !== client.key),
                    )
                  }
                >
                  {client.open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                </button>
                <Link
                  className="project-client-toggle"
                  to="/hub"
                  search={{
                    environment: client.environmentId,
                    ...(client.clientId ? { client: client.clientId } : {}),
                  }}
                  onClick={close}
                  aria-current={
                    routeSearch.client === client.clientId &&
                    routeSearch.environment === client.environmentId
                      ? "page"
                      : undefined
                  }
                >
                  {client.clientId ? <Building2Icon size={18} /> : <FolderIcon size={18} />}
                  <span>{client.title}</span>
                  {client.archived && <small>Archived</small>}
                </Link>
                {client.clientId && (
                  <HubChatButton
                    environmentId={client.environmentId}
                    projectId={null}
                    clientId={client.clientId}
                    clientName={client.title}
                    compact
                    disabled={client.archived}
                    onStarted={() => {
                      setCollapsedClients((current) => current.filter((key) => key !== client.key));
                      close();
                    }}
                  />
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={client.archived}
                  aria-label={`New project for ${client.title}`}
                  onClick={() => {
                    setCollapsedClients((current) => current.filter((key) => key !== client.key));
                    close();
                    void navigate({
                      to: "/hub",
                      search: {
                        create: true,
                        environment: client.environmentId,
                        ...(client.clientId ? { client: client.clientId } : {}),
                      },
                    });
                  }}
                >
                  <FolderPlusIcon />
                </Button>
              </div>
              {environments.length > 1 && (
                <small className="project-sidebar-environment">
                  {environments.find((env) => env.environmentId === client.environmentId)?.label}
                </small>
              )}
              {client.open && (
                <div className="project-client-projects">
                  {client.chats.length > 0 && (
                    <ul className="project-sidebar-chats">
                      {client.chats.map((thread) => (
                        <ChatRow
                          key={`${thread.environmentId}:${thread.id}`}
                          thread={thread}
                          active={
                            thread.id === params.threadId &&
                            thread.environmentId === params.environmentId
                          }
                          close={close}
                        />
                      ))}
                      {client.moreChats && (
                        <li>
                          <button
                            className="project-show-more"
                            onClick={() => setExpanded((current) => [...current, client.key])}
                          >
                            Show more chats
                          </button>
                        </li>
                      )}
                    </ul>
                  )}
                  {client.groups.map(renderProject)}
                  {!client.groups.length && !client.chats.length && (
                    <p className="project-sidebar-empty">No chats or projects yet.</p>
                  )}
                </div>
              )}
            </section>
          ))}
          {dragged &&
            !rows.clients.some(
              (client) =>
                client.environmentId === dragged.environmentId && client.clientId === null,
            ) && (
              <section
                className="project-client-group project-personal-drop"
                aria-label="Personal projects"
                {...dropProps({
                  environmentId: dragged.environmentId,
                  clientId: null,
                  title: "Personal projects",
                  archived: false,
                })}
              >
                <div className="project-client-heading">
                  <FolderIcon size={18} />
                  <span>Personal projects</span>
                </div>
                <p className="project-sidebar-empty">Drop here to remove the client.</p>
              </section>
            )}
          {!projects.length && !clients.some((client) => !client.archived) && (
            <p className="project-sidebar-empty">
              Create a project to keep your chats and notes together.
            </p>
          )}
          <section className="project-free-chats" aria-label="Free chats">
            <div className="project-client-heading">
              <button
                className="project-client-toggle"
                aria-expanded={freeOpen}
                aria-label={`${freeOpen ? "Collapse" : "Expand"} Free chats`}
                onClick={() =>
                  setCollapsedClients((current) =>
                    freeOpen ? [...current, "free"] : current.filter((key) => key !== "free"),
                  )
                }
              >
                {freeOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                <MessageSquareIcon size={18} />
                <span>Free chats</span>
              </button>
              {environmentId && (
                <HubChatButton
                  key={environmentId}
                  environmentId={environmentId}
                  projectId={null}
                  compact
                  onStarted={() => {
                    setCollapsedClients((current) => current.filter((key) => key !== "free"));
                    close();
                  }}
                />
              )}
            </div>
            {freeOpen && (
              <ul className="project-sidebar-chats">
                {freeVisible.map((thread) => (
                  <ChatRow
                    key={`${thread.environmentId}:${thread.id}`}
                    thread={thread}
                    active={
                      thread.id === params.threadId && thread.environmentId === params.environmentId
                    }
                    close={close}
                  />
                ))}
                {rows.other.length > freeVisible.length && (
                  <li>
                    <button
                      className="project-show-more"
                      onClick={() => setExpanded((current) => [...current, "free"])}
                    >
                      Show more
                    </button>
                  </li>
                )}
                {!freeVisible.length && (
                  <li className="project-sidebar-empty">Chats outside your projects.</li>
                )}
              </ul>
            )}
          </section>
          <Drafts close={close} />
        </div>
      </SidebarContent>
      <SidebarChromeFooter />
      {clientsOpen && environmentId && (
        <ProjectClientsDialog environmentId={environmentId} onClose={() => setClientsOpen(false)} />
      )}
    </>
  );
}

function Drafts({ close }: { close: () => void }) {
  const sessions = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const folders = useProjects();
  const drafts = Object.entries(sessions).filter(([, session]) => !session.promotedTo);
  if (!drafts.length) return null;
  return (
    <section>
      <div className="project-sidebar-heading">Drafts</div>
      <ul className="project-sidebar-chats">
        {drafts.map(([draftId, draft]) => (
          <li key={draftId} className="project-chat-row">
            <Link to="/draft/$draftId" params={{ draftId: draftId }} onClick={close}>
              <span>
                New chat ·{" "}
                {folders.find(
                  (folder) =>
                    folder.id === draft.projectId && folder.environmentId === draft.environmentId,
                )?.title ?? "Draft"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
