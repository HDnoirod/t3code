import { useNowMinute } from "../../hooks/useNowMinute";
import { projectWorkingFolderIds } from "./projectNavigation";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, HubItem, HubKind, HubSaveInput } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  CheckCheckIcon,
  DownloadIcon,
  FolderKanbanIcon,
  PinIcon,
  PlusIcon,
  RotateCwIcon,
  UsersIcon,
} from "lucide-react";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { isStandaloneChatWorkspace } from "@t3tools/contracts";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  hubExportCommand,
  hubItemQuery,
  hubListQuery,
  hubSaveCommand,
} from "../../state/workspaceHub";
import {
  timeTrackingMutation,
  timeTrackingQuery,
  timeTrackingReportQuery,
} from "../../state/timeTracking";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ClientsDialog } from "../timeTracking/ClientsDialog";
import {
  TimeEntryDialog,
  type EntryDraft,
  type SaveTimeChange,
} from "../timeTracking/TimeEntryDialog";
import { dateKey, formatHours } from "../timeTracking/calendar";
import { formatMoney, reportRange, summarizeReport } from "../timeTracking/report";
import { HubEditor, HubMarkdown } from "./HubEditor";
import { belongsToClient, downloadFile, newHubItem, relatedHubItems, safeFilename } from "./hub";
import { HubChatButton } from "./HubChatButton";

export function HubPage({
  initialView,
  selectedEnvironment,
  selectedItem,
  createNew,
}: {
  initialView: "note" | "project";
  selectedEnvironment?: string | undefined;
  selectedItem?: string | undefined;
  createNew?: boolean | undefined;
}) {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const [chosen, setChosen] = useState<EnvironmentId | null>(null);
  const environmentId =
    environments.find(
      (environment) => environment.environmentId === (chosen ?? selectedEnvironment),
    )?.environmentId ??
    primary ??
    environments[0]?.environmentId;
  return (
    <main className="hub-page">
      <header className={`hub-titlebar ${isElectron ? "drag-region" : ""}`}>
        <FolderKanbanIcon size={17} />
        <span>{initialView === "note" ? "Notes & tasks" : "Projects"}</span>
        {environments.length > 1 && (
          <label className="hub-environment no-drag">
            <span className="sr-only">Computer</span>
            <select
              className="hub-select"
              value={environmentId ?? ""}
              onChange={(event) =>
                setChosen(
                  environments.find(
                    (environment) => environment.environmentId === event.target.value,
                  )?.environmentId ?? null,
                )
              }
            >
              {environments.map((environment) => (
                <option key={environment.environmentId} value={environment.environmentId}>
                  {environment.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {environmentId ? (
        <HubWorkspace
          key={`${environmentId}:${initialView}`}
          environmentId={environmentId}
          initialView={initialView}
          selectedItem={selectedItem}
          createNew={createNew}
        />
      ) : (
        <div className="hub-empty">
          <h1>A home for your work.</h1>
          <p>Connect an environment to keep notes, projects and tasks together.</p>
        </div>
      )}
    </main>
  );
}

function HubWorkspace({
  environmentId,
  initialView,
  selectedItem,
  createNew,
}: {
  environmentId: EnvironmentId;
  initialView: HubKind;
  selectedItem?: string | undefined;
  createNew?: boolean | undefined;
}) {
  const nowMinute = useNowMinute();
  const [chosenView, setView] = useState<HubKind>(initialView);
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [filter, setFilter] = useState("all");
  const selected = selectedItem ?? null;
  const detailPane = useRef<HTMLElement>(null);
  const lastOpenedCard = useRef<HTMLButtonElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves DOM focus between the selected detail pane and its originating card
  useEffect(() => {
    if (selected) {
      detailPane.current?.scrollTo({ top: 0 });
      detailPane.current?.focus({ preventScroll: true });
    } else {
      lastOpenedCard.current?.focus({ preventScroll: true });
    }
  }, [selected]);
  const [editor, setEditor] = useState<HubSaveInput | null>(() =>
    createNew ? newHubItem("project") : null,
  );
  const [clientsOpen, setClientsOpen] = useState(false);
  const [timeDraft, setTimeDraft] = useState<EntryDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [aiWorkspace, setAiWorkspace] = useState("");
  const index = useEnvironmentQuery(hubListQuery({ environmentId, input: { search: "" } }));
  const results = useEnvironmentQuery(
    searchTerm ? hubListQuery({ environmentId, input: { search: searchTerm } }) : null,
  );
  const detail = useEnvironmentQuery(
    selected ? hubItemQuery({ environmentId, input: { id: selected } }) : null,
  );
  const today = dateKey(new Date(`${nowMinute}:00Z`));
  const time = useEnvironmentQuery(
    timeTrackingQuery({ environmentId, input: { from: today, to: today } }),
  );
  const month = reportRange(new Date(`${nowMinute}:00Z`), "month");
  const report = useEnvironmentQuery(
    timeTrackingReportQuery({
      environmentId,
      input: {
        ...month,
        clientIds: clientId ? [clientId] : null,
        ...(detail.data?.kind === "project" ? { projectId: detail.data.id } : {}),
      },
    }),
  );
  const saveCommand = useAtomCommand(hubSaveCommand, { reportFailure: false });
  const timeCommand = useAtomCommand(timeTrackingMutation, { reportFailure: false });
  const exportCommand = useAtomCommand(hubExportCommand, { reportFailure: false });
  const newThread = useNewThreadHandler();
  const navigate = useNavigate();
  const setSelected = (id: string | null) => {
    void navigate({
      to: "/notes",
      search: { environment: environmentId, ...(id ? { item: id } : {}) },
    });
  };
  const workspaces = useProjects().filter(
    (project) => project.environmentId === environmentId && !isStandaloneChatWorkspace(project.id),
  );
  const threads = useThreadShells().filter((thread) => thread.environmentId === environmentId);
  const items = index.data?.items ?? [];
  const clients = time.data?.clients ?? [];
  const item = detail.data?.id === selected ? detail.data : null;
  const view = item?.kind ?? items.find((value) => value.id === selected)?.kind ?? chosenView;
  const summary = summarizeReport(report.data?.rows ?? []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the search debounce timer and cancels it when the input changes
  useEffect(() => {
    const timeout = setTimeout(() => setSearchTerm(search.trim()), 250);
    return () => clearTimeout(timeout);
  }, [search]);
  const refreshIndex = index.refresh;
  const refreshDetail = detail.refresh;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes cached hub queries when the window regains focus
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        refreshIndex();
        refreshDetail();
      }
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refreshIndex, refreshDetail]);
  const saved = (value: HubItem) => {
    setEditor(null);
    if (!createNew) setSelected(value.id);
    setView(value.kind);
    setError(null);
    if (createNew)
      void navigate({
        to: "/hub",
        search: { environment: environmentId, item: value.id },
        replace: true,
      });
    index.refresh();
    results.refresh();
    detail.refresh();
  };
  const saveItem = async (value: HubSaveInput) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    return await (async () => {
      const result = await saveCommand({ environmentId, input: value });
      if (result._tag === "Success") saved(result.value);
      else throw squashAtomCommandFailure(result);
    })()
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not save this change.");
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const saveTime: SaveTimeChange = async (change) => {
    return await (async () => {
      const result = await timeCommand({ environmentId, input: change });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      time.refresh();
      report.refresh();
      return null;
    })().catch((cause) => {
      return cause instanceof Error ? cause.message : "Could not save time tracking data.";
    });
  };
  const add = (kind: HubKind, context?: HubItem) => {
    setEditor(
      newHubItem(kind, {
        clientIds: context?.clientIds ?? (clientId ? [clientId] : []),
        projectIds:
          context?.kind === "project"
            ? [context.id]
            : (context?.projectIds ?? (projectId ? [projectId] : [])),
        ...(context?.kind === "note" && kind === "task"
          ? { title: context.title, body: context.body, relatedIds: [context.id] }
          : {}),
      }),
    );
  };
  const exportWorkspace = async () => {
    setBusy(true);
    setError(null);
    return await (async () => {
      const result = await exportCommand({ environmentId, input: {} });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      const { default: JSZip } = await loadJsZip();
      const zip = new JSZip();
      zip.file("workspace.json", JSON.stringify({ ...result.value, clients }, null, 2));
      for (const record of result.value.items)
        zip.file(
          `${record.kind}s/${safeFilename(record.title)}-${safeFilename(record.id)}.md`,
          `# ${record.title}\n\n${record.body}\n\n${record.contacts ? `## Contacts\n${record.contacts}\n\n` : ""}${record.resources.map((resource) => `- [${resource.label}](${resource.url})`).join("\n")}`,
        );
      downloadFile(
        `t3-workspace-${today}.zip`,
        await zip.generateAsync({ type: "blob" }),
        "application/zip",
      );
      setMessage(
        "Exported notes, projects, tasks, links and client details. Calendar data can be exported from Reports.",
      );
    })()
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not export workspace.");
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const askAi = async () => {
    if (!item) return;
    const workspace =
      workspaces.find((value) => value.id === aiWorkspace) ??
      workspaces.find((value) => item.workspaceIds.includes(value.id));
    if (!workspace) {
      setError("Choose a T3 workspace folder for the new chat.");
      return;
    }
    setBusy(true);
    setError(null);
    return await (async () => {
      const draft = await newThread({ environmentId, projectId: workspace.id });
      if (draft) {
        const store = useComposerDraftStore.getState();
        const existing = store.getComposerDraft(draft.draftId)?.prompt ?? "";
        const context = `Help me with this ${item.kind}.\n\n# ${item.title}\n\n${item.body}\n\n${item.contacts ? `Contacts:\n${item.contacts}\n\n` : ""}${item.resources.map((resource) => `${resource.label}: ${resource.url}`).join("\n")}`;
        store.setPrompt(draft.draftId, existing ? `${existing}\n\n${context}` : context);
      }
    })()
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not prepare the chat.");
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const logTime = (record: HubItem) => {
    const project =
      record.kind === "project" ? record : items.find((value) => value.id === record.projectIds[0]);
    const client =
      clients.find(
        (value) =>
          !value.archived &&
          (record.clientIds.includes(value.id) || project?.clientIds.includes(value.id)),
      ) ?? clients.find((value) => !value.archived);
    if (!client) {
      setClientsOpen(true);
      return;
    }
    setTimeDraft({
      type: "entry.save",
      id: randomUUID(),
      version: 0,
      clientId: client.id,
      projectId: project?.id ?? null,
      date: today,
      startMinute: 540,
      endMinute: 600,
      task: record.title.slice(0, 160),
      notes: "",
      hourlyRateCents: client.hourlyRateCents,
      currency: client.currency,
    });
  };
  const shown = (searchTerm ? (results.data?.items ?? []) : items)
    .filter(
      (value) =>
        value.kind === view &&
        belongsToClient(value, clientId, items) &&
        (!projectId || value.id === projectId || value.projectIds.includes(projectId)) &&
        (filter === "archived" ? value.archived : !value.archived) &&
        (filter !== "inbox" ||
          (value.projectIds.length === 0 && value.clientIds.length === 0 && !value.folder)) &&
        (filter !== "pinned" || value.pinned) &&
        (filter !== "today" ||
          (value.kind === "task" &&
            value.status !== "done" &&
            value.dueDate !== null &&
            value.dueDate <= today)) &&
        (filter !== "upcoming" ||
          (value.kind === "task" &&
            value.status !== "done" &&
            value.dueDate !== null &&
            value.dueDate > today)) &&
        (filter !== "waiting" || value.status === "waiting") &&
        (filter !== "done" || value.status === "done") &&
        (!filter.startsWith("folder:") || value.folder === filter.slice(7)) &&
        (!filter.startsWith("tag:") || value.tags.includes(filter.slice(4))),
    )
    .toSorted(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (view === "task"
          ? (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")
          : b.updatedAt.localeCompare(a.updatedAt)),
    );
  const linked = item ? relatedHubItems(item, items) : [];
  const contextWorkspaces = item
    ? projectWorkingFolderIds(item, threads).flatMap((id) => {
        const workspace = workspaces.find((value) => value.id === id);
        return workspace ? [workspace] : [];
      })
    : [];
  const contextThreads = item
    ? threads.filter(
        (thread) => item.threadIds.includes(thread.id) && !item.chatIds.includes(thread.id),
      )
    : [];
  return (
    <>
      <div
        className="hub-workspace"
        data-seasonal-canvas
        data-item-open={selected ? "true" : "false"}
      >
        <div className="hub-heading">
          <div>
            <h1>
              {view === "project"
                ? "Projects"
                : view === "note"
                  ? "Notes & ideas"
                  : "Tasks & next steps"}
            </h1>
            <p className="hub-muted">Capture an idea, find a reference, or follow up on a task.</p>
          </div>
          <div className="hub-actions">
            <Button variant="outline" onClick={() => setClientsOpen(true)} disabled={!time.data}>
              <UsersIcon />
              Clients
            </Button>
            <Button
              variant="outline"
              onClick={() => void exportWorkspace()}
              disabled={busy || !index.data || !time.data}
            >
              <DownloadIcon />
              Export
            </Button>
            <Button onClick={() => add(view)} disabled={!index.data}>
              <PlusIcon />
              New {view}
            </Button>
          </div>
        </div>
        <div className="hub-toolbar">
          <div className="hub-tabs" role="group" aria-label="Notes and tasks">
            {(["note", "task"] as const).map((kind) => (
              <Button
                key={kind}
                variant={view === kind ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={view === kind}
                onClick={() => {
                  setView(kind);
                  setFilter("all");
                  setSelected(null);
                }}
              >
                {kind === "task" ? "Tasks" : "Notes"}
              </Button>
            ))}
          </div>
          <label className="hub-search">
            <span className="sr-only">Search notes and tasks</span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search notes…"
            />
          </label>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh workspace"
            onClick={() => {
              index.refresh();
              results.refresh();
              detail.refresh();
              time.refresh();
              report.refresh();
            }}
          >
            <RotateCwIcon />
          </Button>
        </div>
        <div className="hub-filters">
          <select
            className="hub-select"
            aria-label="Filter by client"
            value={clientId}
            onChange={(event) => {
              setClientId(event.target.value);
              setProjectId("");
              setSelected(null);
            }}
          >
            <option value="">All clients & personal work</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
                {client.archived ? " (archived)" : ""}
              </option>
            ))}
          </select>
          <select
            className="hub-select"
            aria-label="Filter by project"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setSelected(null);
            }}
          >
            <option value="">All projects</option>
            {items
              .filter(
                (value) =>
                  value.kind === "project" && (!clientId || value.clientIds.includes(clientId)),
              )
              .map((value) => (
                <option key={value.id} value={value.id}>
                  {value.title}
                </option>
              ))}
          </select>
          <select
            className="hub-select"
            aria-label="Filter items"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setSelected(null);
            }}
          >
            <option value="all">All {view}s</option>
            <option value="pinned">Pinned</option>
            {view === "note" && <option value="inbox">Inbox · unfiled</option>}
            {view === "task" && (
              <>
                <option value="today">Today & overdue</option>
                <option value="upcoming">Upcoming</option>
                <option value="waiting">Waiting</option>
                <option value="done">Done</option>
              </>
            )}
            <option value="archived">Archived</option>
            {view === "note" &&
              [
                ...new Set(
                  items
                    .filter((value) => value.kind === "note" && value.folder)
                    .map((value) => value.folder),
                ),
              ]
                .sort()
                .map((folder) => (
                  <option key={folder} value={`folder:${folder}`}>
                    Collection: {folder}
                  </option>
                ))}
            {[...new Set(items.flatMap((value) => value.tags))].sort().map((tag) => (
              <option key={tag} value={`tag:${tag}`}>
                Tag: {tag}
              </option>
            ))}
          </select>
          {(search || clientId || projectId || filter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setSearchTerm("");
                setClientId("");
                setProjectId("");
                setFilter("all");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        {(error || index.error || results.error || time.error) && (
          <p className="hub-banner hub-error" role="alert">
            {error ?? index.error ?? results.error ?? time.error}
          </p>
        )}
        {message && (
          <p className="hub-banner" role="status">
            {message}
          </p>
        )}
        {(searchTerm ? results.data?.truncated : index.data?.truncated) && (
          <p className="hub-banner">
            Showing the most recent 2,000 items. Search to find older information.
          </p>
        )}
        <div className="hub-layout">
          <section className="hub-list" aria-label={`${view}s`}>
            <p className="hub-list-count">
              {shown.length} {view}
              {shown.length === 1 ? "" : "s"}
            </p>
            {shown.map((value) => (
              <button
                type="button"
                key={value.id}
                className="hub-card"
                aria-pressed={selected === value.id}
                onClick={(event) => {
                  lastOpenedCard.current = event.currentTarget;
                  setSelected(value.id);
                  setAiWorkspace("");
                  setError(null);
                }}
              >
                <div className="hub-card-title">
                  {value.pinned && <PinIcon size={13} />}
                  <strong>{value.title}</strong>
                  {value.archived && <ArchiveIcon size={13} />}
                </div>
                <div className="hub-chips">
                  {value.kind !== "note" && (
                    <span data-status={value.status}>
                      {value.status === "todo"
                        ? "To do"
                        : value.status === "doing"
                          ? "In progress"
                          : value.status}
                    </span>
                  )}
                  {value.projectIds.length > 1 && (
                    <span>Shared · {value.projectIds.length} projects</span>
                  )}
                  {value.priority === "high" && value.kind === "task" && <span>High priority</span>}
                  {value.dueDate && (
                    <span data-overdue={value.dueDate < today && value.status !== "done"}>
                      Due {value.dueDate}
                    </span>
                  )}
                </div>
                <small>
                  {value.clientIds
                    .map((id) => clients.find((client) => client.id === id)?.name)
                    .filter(Boolean)
                    .join(" · ") ||
                    value.projectIds
                      .map((id) => items.find((project) => project.id === id)?.title)
                      .filter(Boolean)
                      .join(" · ") ||
                    value.folder ||
                    "Personal / unfiled"}
                </small>
                {value.tags.length > 0 && (
                  <div className="hub-card-tags">
                    {value.tags.map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>
                )}
              </button>
            ))}
            {shown.length === 0 && (
              <div className="hub-list-empty">
                <BookOpenIcon size={27} />
                <h2>
                  {index.isPending || results.isPending ? "Loading…" : "Room for your next idea."}
                </h2>
                <p>
                  {search || clientId || projectId || filter !== "all"
                    ? "No items match these filters."
                    : `Create a ${view} to get started. You can connect it to projects later.`}
                </p>
              </div>
            )}
          </section>
          <section className="hub-detail" aria-label="Selected item" ref={detailPane} tabIndex={-1}>
            {selected && (
              <div className="hub-detail-back">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setView(view);
                    setSelected(null);
                  }}
                >
                  <ArrowLeftIcon /> Back to {view === "task" ? "tasks" : "notes"}
                </Button>
              </div>
            )}
            {selected && detail.error && (
              <p className="hub-error" role="alert">
                {detail.error}
              </p>
            )}
            {selected && !item && !detail.error && <p className="hub-muted">Loading item…</p>}
            {item ? (
              <>
                <div className="hub-detail-heading">
                  <p className="hub-eyebrow">
                    {item.kind.toUpperCase()}
                    {item.archived ? " · ARCHIVED" : ""}
                  </p>
                  <h2>{item.title}</h2>
                  <div className="hub-actions hub-wrap">
                    <Button size="sm" onClick={() => setEditor(item)} disabled={busy}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void saveItem({ ...item, pinned: !item.pinned })}
                    >
                      <PinIcon />
                      {item.pinned ? "Unpin" : "Pin"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void saveItem({ ...item, archived: !item.archived })}
                    >
                      <ArchiveIcon />
                      {item.archived ? "Restore" : "Archive"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        downloadFile(
                          `${safeFilename(item.title)}.md`,
                          `# ${item.title}\n\n${item.body}`,
                          "text/markdown;charset=utf-8",
                        )
                      }
                    >
                      Export Markdown
                    </Button>
                    {item.kind === "task" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void saveItem({
                            ...item,
                            status: item.status === "done" ? "todo" : "done",
                          })
                        }
                      >
                        <CheckCheckIcon />
                        {item.status === "done" ? "Reopen" : "Complete"}
                      </Button>
                    )}
                  </div>
                </div>
                {item.kind === "note" && item.aiContext && (
                  <p className="hub-context-label">
                    Shared with AI · included in linked client and project chats
                  </p>
                )}
                {(item.projectIds.length > 0 || item.clientIds.length > 0) && (
                  <div className="hub-chips">
                    {item.clientIds.map((id) => (
                      <Link key={id} to="/hub" search={{ environment: environmentId, client: id }}>
                        {clients.find((client) => client.id === id)?.name ?? "Unavailable client"}
                      </Link>
                    ))}
                    {item.projectIds.map((id) => (
                      <Link key={id} to="/hub" search={{ environment: environmentId, item: id }}>
                        {items.find((value) => value.id === id)?.title ?? "Linked project"}{" "}
                        <ArrowUpRightIcon size={11} />
                      </Link>
                    ))}
                  </div>
                )}
                <HubMarkdown>
                  {item.body ||
                    (item.kind === "project"
                      ? "Add a brief to give this project a clear direction."
                      : "No details yet. Choose Edit to add some.")}
                </HubMarkdown>
                {(contextWorkspaces.length > 0 || contextThreads.length > 0) && (
                  <div className="hub-section">
                    <div className="hub-section-heading">
                      <h3>Linked folders & chats</h3>
                      {item.kind === "project" && (
                        <Button size="sm" variant="outline" onClick={() => setEditor(item)}>
                          Manage folders
                        </Button>
                      )}
                    </div>
                    {contextWorkspaces.map((workspace) => (
                      <div className="hub-folder" key={workspace.id}>
                        <strong>{workspace.title}</strong>
                        <code>{workspace.workspaceRoot}</code>
                        {item.archived ? null : item.kind === "project" ? (
                          <HubChatButton
                            environmentId={environmentId}
                            projectId={item.id}
                            workspaceId={workspace.id}
                          />
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void newThread({ environmentId, projectId: workspace.id })
                            }
                          >
                            Open new chat
                          </Button>
                        )}
                      </div>
                    ))}
                    {contextThreads.slice(0, 25).map((thread) => (
                      <button
                        type="button"
                        className="hub-related"
                        key={thread.id}
                        onClick={() =>
                          void navigate({
                            to: "/$environmentId/$threadId",
                            params: { environmentId, threadId: thread.id },
                          })
                        }
                      >
                        <span>Chat</span>
                        <strong>{thread.title}</strong>
                        <ArrowUpRightIcon size={14} />
                      </button>
                    ))}
                    {contextThreads.length > 25 && (
                      <p className="hub-muted">
                        Showing 25 chats. Open the workspace for the full history.
                      </p>
                    )}
                    {contextWorkspaces.length === 0 && contextThreads.length === 0 && (
                      <p className="hub-muted">
                        Choose Edit to connect an existing working folder or create a new one.
                      </p>
                    )}
                  </div>
                )}
                {item.kind === "project" && (
                  <div className="hub-section">
                    <div className="hub-section-heading">
                      <h3>Project chats</h3>
                      {!item.archived && (
                        <HubChatButton
                          key={item.id}
                          environmentId={environmentId}
                          projectId={item.id}
                        />
                      )}
                    </div>
                    <p className="hub-muted">
                      The project brief and AI context notes are included when you send a message.
                      Choose your provider in the chat.
                    </p>
                    {threads
                      .filter((thread) => item.chatIds.includes(thread.id) && !thread.archivedAt)
                      .map((thread) => (
                        <Link
                          key={thread.id}
                          className="hub-related"
                          to="/$environmentId/$threadId"
                          params={{ environmentId, threadId: thread.id }}
                        >
                          <span>Chat</span>
                          <strong>{thread.title}</strong>
                          <ArrowUpRightIcon size={14} />
                        </Link>
                      ))}
                    {!item.chatIds.length && (
                      <p className="hub-muted">
                        Start a chat here, or add existing chats from Edit → Organize.
                      </p>
                    )}
                  </div>
                )}
                {item.kind === "project" && (
                  <div className="hub-section">
                    <div className="hub-section-heading">
                      <h3>AI context</h3>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEditor(
                            newHubItem("note", {
                              projectIds: [item.id],
                              clientIds: item.clientIds,
                              aiContext: true,
                            }),
                          )
                        }
                      >
                        Add AI note
                      </Button>
                    </div>
                    <p className="hub-muted">
                      Your project brief is included automatically. Only notes marked “Use as AI
                      context” are shared with this project's chats. Other chat histories are not
                      included.
                    </p>
                    {items
                      .filter(
                        (note) =>
                          note.kind === "note" &&
                          note.aiContext &&
                          !note.archived &&
                          note.projectIds.includes(item.id),
                      )
                      .map((note) => (
                        <button
                          type="button"
                          className="hub-related"
                          key={note.id}
                          onClick={() => setSelected(note.id)}
                        >
                          <span>Note</span>
                          <strong>{note.title}</strong>
                          <ArrowUpRightIcon size={14} />
                        </button>
                      ))}
                  </div>
                )}
                {item.contacts && (
                  <div className="hub-section">
                    <h3>Contacts</h3>
                    <p className="hub-plain-text">{item.contacts}</p>
                  </div>
                )}
                {item.resources.length > 0 && (
                  <div className="hub-section">
                    <h3>Files & references</h3>
                    {item.resources.map((resource) => (
                      <a
                        className="hub-resource"
                        key={`${resource.url}:${resource.label}`}
                        href={resource.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {resource.label}
                        <ArrowUpRightIcon size={13} />
                      </a>
                    ))}
                  </div>
                )}
                <div className="hub-section">
                  <div className="hub-section-heading">
                    <h3>Connected work</h3>
                    <div className="hub-actions">
                      {item.kind === "project" && (
                        <Button size="sm" variant="outline" onClick={() => add("note", item)}>
                          Add note
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => add("task", item)}>
                        {item.kind === "note" ? "Create linked task" : "Add task"}
                      </Button>
                    </div>
                  </div>
                  {linked.length ? (
                    linked.map((value) => (
                      <button
                        className="hub-related"
                        type="button"
                        key={value.id}
                        onClick={() =>
                          value.kind === "project"
                            ? void navigate({
                                to: "/hub",
                                search: { environment: environmentId, item: value.id },
                              })
                            : setSelected(value.id)
                        }
                      >
                        <span>{value.kind}</span>
                        <strong>{value.title}</strong>
                        <small>
                          {value.archived ? "Archived" : value.kind === "task" ? value.status : ""}
                        </small>
                        <ArrowUpRightIcon size={14} />
                      </button>
                    ))
                  ) : (
                    <p className="hub-muted">
                      Link existing notes, projects or tasks from Edit → Organize.
                    </p>
                  )}
                </div>
                {(item.kind === "project" || item.kind === "task") && (
                  <div className="hub-section">
                    <div className="hub-section-heading">
                      <h3>
                        {item.kind === "project" ? "Project time · this month" : "Time tracking"}
                      </h3>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => logTime(item)}
                        disabled={!time.data || item.archived}
                      >
                        Log time
                      </Button>
                    </div>
                    {item.kind === "project" && (
                      <>
                        {report.error ? (
                          <p className="hub-error">{report.error}</p>
                        ) : !report.data ? (
                          <p className="hub-muted">Loading recorded time…</p>
                        ) : (
                          <div className="hub-metrics">
                            <strong>{formatHours(summary.minutes)}</strong>
                            {summary.totals.map(([currency, amountCents]) => (
                              <strong key={currency}>{formatMoney(amountCents, currency)}</strong>
                            ))}
                          </div>
                        )}
                        <p className="hub-muted">
                          Only entries assigned to this project are included.
                          {clientId
                            ? ` Filtered to ${clients.find((client) => client.id === clientId)?.name ?? "the selected client"}.`
                            : ""}{" "}
                          Unpriced hours are not counted as zero earnings.
                        </p>
                      </>
                    )}
                    <Link to="/calendar" className="hub-inline-link">
                      Open calendar & reports →
                    </Link>
                  </div>
                )}
                {item.kind !== "project" && (
                  <details className="hub-section hub-ai">
                    <summary>Use this in a new chat</summary>
                    <div>
                      <p className="hub-muted">
                        Prepare a chat with this item’s saved content. Review the message before
                        sending it.
                      </p>
                    </div>
                    <div className="hub-actions hub-wrap">
                      <select
                        aria-label="Workspace for AI chat"
                        className="hub-select"
                        value={aiWorkspace || contextWorkspaces[0]?.id || ""}
                        onChange={(event) => setAiWorkspace(event.target.value)}
                      >
                        <option value="">Choose workspace folder…</option>
                        {workspaces.map((workspace) => (
                          <option key={workspace.id} value={workspace.id}>
                            {workspace.title}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || workspaces.length === 0}
                        onClick={() => void askAi()}
                      >
                        Prepare AI chat
                      </Button>
                    </div>
                  </details>
                )}
                <p className="hub-detail-footer">
                  Updated {new Date(item.updatedAt).toLocaleString()} · Saved on this computer
                </p>
              </>
            ) : (
              !selected && (
                <div className="hub-overview">
                  <div className="hub-overview-icon">
                    <FolderKanbanIcon size={32} />
                  </div>
                  <h2>Keep the context with the work.</h2>
                  <p>
                    Select a {view}, or create one. Link notes and tasks to as many projects as you
                    need.
                  </p>
                  <div className="hub-overview-stats">
                    <div>
                      <strong>
                        {
                          items.filter(
                            (value) =>
                              value.kind === "project" &&
                              !value.archived &&
                              value.status !== "complete",
                          ).length
                        }
                      </strong>
                      <span>Active projects</span>
                    </div>
                    <div>
                      <strong>
                        {
                          items.filter(
                            (value) =>
                              value.kind === "task" && !value.archived && value.status !== "done",
                          ).length
                        }
                      </strong>
                      <span>Open tasks</span>
                    </div>
                    <div>
                      <strong>
                        {items.filter((value) => value.kind === "note" && !value.archived).length}
                      </strong>
                      <span>Notes</span>
                    </div>
                  </div>
                  <p className="hub-muted">
                    Shared links keep edits consistent. Archiving preserves the history and can be
                    reversed.
                  </p>
                </div>
              )
            )}
          </section>
        </div>
      </div>
      {editor && (
        <HubEditor
          key={editor.id}
          initial={editor}
          environmentId={environmentId}
          items={items}
          clients={clients}
          onClose={() => {
            setEditor(null);
            if (createNew)
              void navigate({ to: "/hub", search: { environment: environmentId }, replace: true });
          }}
          onSaved={saved}
        />
      )}
      {clientsOpen && (
        <ClientsDialog
          environmentId={environmentId}
          clients={clients}
          onClose={() => setClientsOpen(false)}
          onSave={saveTime}
        />
      )}
      {timeDraft && (
        <TimeEntryDialog
          key={timeDraft.id}
          draft={timeDraft}
          clients={clients}
          projects={items.filter((value) => value.kind === "project")}
          onClose={() => setTimeDraft(null)}
          onSave={saveTime}
        />
      )}
    </>
  );
}

const loadJsZip = () => import("jszip");
