import { useNowMinute } from "../../hooks/useNowMinute";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  FolderIcon,
  SettingsIcon,
  PlusIcon,
  ChevronRightIcon,
  MessageSquareIcon,
} from "lucide-react";
import type { HubItem, HubSaveInput, HubSummary } from "@t3tools/contracts";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { hubItemQuery, hubListQuery } from "../../state/workspaceHub";
import { timeTrackingQuery, timeTrackingReportQuery } from "../../state/timeTracking";
import { dateKey, formatHours } from "../timeTracking/calendar";
import { reportRange, summarizeReport, formatMoney } from "../timeTracking/report";
import { Button } from "../ui/button";
import { HubEditor, HubMarkdown } from "./HubEditor";
import { HubChatButton } from "./HubChatButton";
import { HubPage } from "./HubPage";
import { newHubItem, relatedHubItems } from "./hub";
import { projectWorkingFolderIds } from "./projectNavigation";
import { useHubProjects } from "./useHubProjects";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { isElectron } from "../../env";
import { WorkspaceOverview } from "./WorkspaceOverview";

export function ProjectHome({
  environment,
  item: selectedId,
  create = false,
  section,
  client,
  focusSearch,
}: {
  environment?: string | undefined;
  item?: string | undefined;
  create?: boolean | undefined;
  section?: "chats" | "notes" | "tasks" | "folders" | "time" | undefined;
  client?: string | undefined;
  focusSearch?: boolean | undefined;
}) {
  const nowMinute = useNowMinute();
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const [selectedEnvironment, setSelectedEnvironment] = useState(
    environment ?? primary ?? environments[0]?.environmentId,
  );
  const environmentId =
    environments.find((env) => env.environmentId === selectedEnvironment)?.environmentId ?? primary;
  const navigate = useNavigate();
  const [tab, setTab] = useState<"chats" | "notes" | "folders" | "tasks" | "time">(
    section ?? "chats",
  );
  const [editor, setEditor] = useState<HubSaveInput | null>(() =>
    create ? newHubItem("project", { clientIds: client ? [client] : [] }) : null,
  );
  const index = useEnvironmentQuery(
    environmentId ? hubListQuery({ environmentId, input: { search: "" } }) : null,
  );
  const detail = useEnvironmentQuery(
    environmentId && selectedId ? hubItemQuery({ environmentId, input: { id: selectedId } }) : null,
  );
  const day = dateKey(new Date(`${nowMinute}:00Z`));
  const clients = useEnvironmentQuery(
    environmentId ? timeTrackingQuery({ environmentId, input: { from: day, to: day } }) : null,
  );
  const period = reportRange(new Date(`${nowMinute}:00Z`), "month");
  const report = useEnvironmentQuery(
    environmentId && selectedId && tab === "time"
      ? timeTrackingReportQuery({
          environmentId,
          input: { ...period, clientIds: null, projectId: selectedId },
        })
      : null,
  );
  const item = detail.data;
  const records = index.data?.items ?? [];
  const allThreads = useThreadShells();
  const allFolders = useProjects();
  const { owners } = useHubProjects();
  const threads = allThreads.filter((thread) => thread.environmentId === environmentId);
  const chats = item
    ? threads.filter(
        (thread) =>
          !thread.archivedAt &&
          (item.chatIds.includes(thread.id) ||
            owners.get(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)))?.id ===
              item.id),
      )
    : [];
  const folders = item
    ? projectWorkingFolderIds(item, threads).flatMap((id) => {
        const folder = allFolders.find(
          (value) => value.environmentId === environmentId && value.id === id,
        );
        return folder ? [folder] : [];
      })
    : [];
  const linked = item ? relatedHubItems(item, records).filter((record) => !record.archived) : [];
  const saved = (value: HubItem) => {
    setEditor(null);
    index.refresh();
    detail.refresh();
    if (environmentId)
      appAtomRegistry.refresh(hubItemQuery({ environmentId, input: { id: value.id } }));
    if (value.kind === "project" && (create || !selectedId))
      void navigate({
        to: "/hub",
        search: { ...(environmentId ? { environment: environmentId } : {}), item: value.id },
        replace: true,
      });
  };
  if (item && item.kind !== "project")
    return (
      <HubPage initialView="note" selectedEnvironment={environment} selectedItem={selectedId} />
    );
  const summary = summarizeReport(report.data?.rows ?? []);
  if (!selectedId && !create)
    return (
      <WorkspaceOverview environment={environment} clientId={client} focusSearch={focusSearch} />
    );
  return (
    <main className="project-home" data-seasonal-canvas>
      <header className={`project-home-titlebar ${isElectron ? "drag-region" : ""}`}>
        <Link to="/hub" className="no-drag">
          Work
        </Link>
        {item?.clientIds[0] && (
          <>
            <ChevronRightIcon size={14} />
            <Link
              className="no-drag"
              to="/hub"
              search={{
                ...(environmentId ? { environment: environmentId } : {}),
                client: item.clientIds[0],
              }}
            >
              {clients.data?.clients.find((client) => client.id === item.clientIds[0])?.name ??
                "Client"}
            </Link>
          </>
        )}
        <ChevronRightIcon size={14} />
        <span>{item?.title ?? "New project"}</span>
      </header>
      <div className="project-home-body">
        {item ? (
          <>
            <div className="project-home-heading">
              <div>
                <h1>{item.title}</h1>
                {item.archived && <p className="hub-muted">Archived project</p>}
              </div>
              <div className="hub-actions">
                {!item.archived && environmentId && (
                  <HubChatButton environmentId={environmentId} projectId={item.id} />
                )}
                <Button
                  variant="outline"
                  aria-label="Project settings"
                  onClick={() => setEditor(item)}
                >
                  <SettingsIcon />
                  Project settings
                </Button>
              </div>
            </div>
            <nav className="project-home-tabs" aria-label="Project sections">
              {(["chats", "notes", "folders", "tasks", "time"] as const).map((value) => (
                <button
                  key={value}
                  aria-current={tab === value ? "page" : undefined}
                  onClick={() => {
                    setTab(value);
                    void navigate({
                      to: "/hub",
                      search: {
                        ...(environmentId ? { environment: environmentId } : {}),
                        item: item.id,
                        section: value,
                      },
                    });
                  }}
                >
                  {value === "folders"
                    ? "Working folders"
                    : value[0]!.toUpperCase() + value.slice(1)}
                  {value !== "time" && (
                    <span>
                      {value === "chats"
                        ? chats.length
                        : value === "folders"
                          ? folders.length
                          : linked.filter(
                              (record) => record.kind === (value === "notes" ? "note" : "task"),
                            ).length}
                    </span>
                  )}
                </button>
              ))}
            </nav>
            {tab === "chats" && (
              <section>
                <p className="hub-muted">
                  Chats share this project's background, selected notes, and folder overviews.
                </p>
                {chats
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .map((thread) => (
                    <Link
                      className="project-home-chat"
                      key={thread.id}
                      to="/$environmentId/$threadId"
                      params={{ environmentId: thread.environmentId, threadId: thread.id }}
                    >
                      <MessageSquareIcon size={17} />
                      <span>{thread.title}</span>
                    </Link>
                  ))}
                {!chats.length && (
                  <p className="project-home-empty">
                    Start a chat to begin working on {item.title}.
                  </p>
                )}
              </section>
            )}
            {(tab === "notes" || tab === "tasks") && (
              <section>
                <div className="project-home-section-heading">
                  <p className="hub-muted">
                    {tab === "notes"
                      ? "Keep useful information with this project. Selected notes are shared with its AI chats."
                      : "What needs to happen next."}
                  </p>
                  <Button
                    size="sm"
                    onClick={() =>
                      setEditor(
                        newHubItem(tab === "notes" ? "note" : "task", {
                          projectIds: [item.id],
                          clientIds: item.clientIds,
                          aiContext: tab === "notes",
                        }),
                      )
                    }
                  >
                    <PlusIcon />
                    {tab === "notes" ? "New note" : "New task"}
                  </Button>
                </div>
                {linked
                  .filter((record) => record.kind === (tab === "notes" ? "note" : "task"))
                  .map((record) => (
                    <NoteCard
                      key={record.id}
                      summary={record}
                      environmentId={environmentId!}
                      onEdit={setEditor}
                    />
                  ))}
                {!linked.some((record) => record.kind === (tab === "notes" ? "note" : "task")) && (
                  <p className="project-home-empty">
                    {tab === "notes"
                      ? "Add notes to keep decisions, references and useful background with this project."
                      : "Add a task to track the next step for this project."}
                  </p>
                )}
                {item.body && tab === "notes" && (
                  <div className="project-note">
                    <h3>Project background</h3>
                    <HubMarkdown>{item.body}</HubMarkdown>
                  </div>
                )}
              </section>
            )}
            {tab === "folders" && (
              <section>
                <div className="project-home-section-heading">
                  <p className="hub-muted">
                    The AI receives a short overview of these folders and reads files as needed.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setEditor(item)}>
                    Manage folders
                  </Button>
                </div>
                {folders.map((folder, index) => (
                  <div className="project-home-folder" key={folder.id}>
                    <FolderIcon size={20} />
                    <div>
                      <strong>{folder.title}</strong>
                      <small>
                        {index === 0 ? "New chats start here" : "Available to project chats"}
                      </small>
                    </div>
                  </div>
                ))}
                {!folders.length && (
                  <p className="project-home-empty">
                    Add your folders in Project settings. You can use more than one.
                  </p>
                )}
              </section>
            )}
            {tab === "time" && (
              <section>
                <h2>This month</h2>
                <div className="hub-metrics">
                  <strong>{formatHours(summary.minutes)}</strong>
                  {summary.totals.map(([currency, amount]) => (
                    <strong key={currency}>{formatMoney(amount, currency)}</strong>
                  ))}
                </div>
                {report.error && <p className="hub-error">{report.error}</p>}
                <Link to="/calendar">Open time tracking and reports →</Link>
              </section>
            )}
          </>
        ) : selectedId ? (
          <p className="hub-muted">{detail.error ?? "Loading project…"}</p>
        ) : (
          <div className="project-home-welcome">
            <FolderIcon size={36} />
            <h1>Your projects, together.</h1>
            <p>Choose a project on the left to see its chats and notes.</p>
            <Button onClick={() => setEditor(newHubItem("project"))}>
              <PlusIcon />
              New project
            </Button>
            {environments.length > 1 && (
              <label className="hub-field">
                Save new projects on
                <select
                  className="hub-select"
                  value={environmentId ?? ""}
                  onChange={(event) => setSelectedEnvironment(event.target.value)}
                >
                  {environments.map((env) => (
                    <option value={env.environmentId} key={env.environmentId}>
                      {env.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <details>
              <summary>Archived projects</summary>
              {records
                .filter((record) => record.kind === "project" && record.archived)
                .map((record) => (
                  <Link
                    key={record.id}
                    to="/hub"
                    search={{
                      ...(environmentId ? { environment: environmentId } : {}),
                      item: record.id,
                    }}
                  >
                    {record.title}
                  </Link>
                ))}
            </details>
          </div>
        )}
      </div>
      {editor && environmentId && (
        <HubEditor
          initial={editor}
          environmentId={environmentId}
          items={records}
          clients={clients.data?.clients ?? []}
          onSaved={saved}
          onClose={() => {
            setEditor(null);
            if (create)
              void navigate({ to: "/hub", search: { environment: environmentId }, replace: true });
          }}
        />
      )}
    </main>
  );
}
function NoteCard({
  summary,
  environmentId,
  onEdit,
}: {
  summary: HubSummary;
  environmentId: NonNullable<ReturnType<typeof usePrimaryEnvironmentId>>;
  onEdit: (item: HubItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const detail = useEnvironmentQuery(
    open ? hubItemQuery({ environmentId, input: { id: summary.id } }) : null,
  );
  const item = detail.data;
  return (
    <details
      className="project-note"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {summary.title}{" "}
        <small className="hub-muted">
          {summary.aiContext
            ? "Shared with AI"
            : summary.kind === "task"
              ? summary.status
              : "Not shared with AI"}
        </small>
      </summary>
      <div className="project-home-section-heading">
        <span>{detail.error ?? (detail.isPending ? "Loading…" : "")}</span>
        {item && (
          <Button variant="ghost" size="sm" onClick={() => onEdit(item)}>
            Edit
          </Button>
        )}
      </div>
      {item && (
        <>
          <small className="hub-muted">
            {item.kind === "note"
              ? item.aiContext
                ? "Shared with AI"
                : "Not shared with AI"
              : item.status}
          </small>
          <HubMarkdown>{item.body}</HubMarkdown>
        </>
      )}
    </details>
  );
}
