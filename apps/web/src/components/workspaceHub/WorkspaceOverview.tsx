import { useEnvironmentProviders } from "../../state/environments";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Building2Icon,
  FolderIcon,
  MessageSquareIcon,
  SearchIcon,
  PlusIcon,
  ArrowUpRightIcon,
  NotebookPenIcon,
  SettingsIcon,
  ChevronRightIcon,
} from "lucide-react";
import type { HubItem, HubSaveInput } from "@t3tools/contracts";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useThreadShells } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { hubListQuery } from "../../state/workspaceHub";
import { useHubProjects } from "./useHubProjects";
import { useHubClients } from "./useHubClients";
import { useOpenProject } from "./useOpenProject";
import { ProjectClientsDialog } from "./ProjectClientsDialog";
import { HubEditor } from "./HubEditor";
import { HubChatButton } from "./HubChatButton";
import { newHubItem } from "./hub";
import { buildWorkspaceOverview } from "./workspaceOverview.logic";
import { openCommandPalette } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function WorkspaceOverview({
  environment,
  clientId,
  focusSearch = false,
}: {
  environment?: string | undefined;
  clientId?: string | undefined;
  focusSearch?: boolean | undefined;
}) {
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const primary = usePrimaryEnvironmentId();
  const environmentId =
    environments.find((env) => env.environmentId === environment)?.environmentId ??
    primary ??
    environments[0]?.environmentId;
  const clients = useHubClients();
  const { projects } = useHubProjects();
  const threads = useThreadShells();
  const openProject = useOpenProject();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [clientsOpen, setClientsOpen] = useState(false);
  const [editor, setEditor] = useState<HubSaveInput | null>(null);
  const index = useEnvironmentQuery(
    environmentId ? hubListQuery({ environmentId, input: { search: "" } }) : null,
  );
  const search = useEnvironmentQuery(
    environmentId && term ? hubListQuery({ environmentId, input: { search: term } }) : null,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the debounce timer for workspace search and cancels obsolete requests
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const client = clients.find(
    (client) => client.id === clientId && client.environmentId === environmentId,
  );
  const records = index.data?.items ?? [];
  const data = environmentId
    ? buildWorkspaceOverview({
        environmentId,
        clientId,
        query,
        projects,
        clients,
        threads,
        records,
        contentMatches:
          term === query.trim() ? (search.data?.items.map((item) => item.id) ?? []) : [],
      })
    : null;
  const config = environments.find((env) => env.environmentId === environmentId)?.serverConfig;
  const account = client?.defaultModelSelection ?? config?.settings.defaultModelSelection;
  const accountName =
    account && environmentId
      ? (providersByEnvironment
          .get(environmentId)
          ?.find((provider) => provider.instanceId === account.instanceId)?.displayName ??
        account.instanceId)
      : "Automatic";
  const saved = (item: HubItem) => {
    setEditor(null);
    index.refresh();
    void navigate({
      to: item.kind === "project" ? "/hub" : "/notes",
      search: { ...(environmentId ? { environment: environmentId } : {}), item: item.id },
    });
  };
  const searching = query.trim().length > 0;
  const isSearching = searching && (term !== query.trim() || search.isPending);
  const noResults =
    data &&
    !data.clients.length &&
    !data.projects.length &&
    !data.chats.length &&
    !data.records.length;
  return (
    <main className="work-home" data-seasonal-canvas>
      <header className={`project-home-titlebar ${isElectron ? "drag-region" : ""}`}>
        <Link to="/hub" className="no-drag">
          Work
        </Link>
        {client && (
          <>
            <ChevronRightIcon size={14} />
            <span>{client.name}</span>
          </>
        )}
        {environments.length > 1 && (
          <label className="work-computer no-drag">
            Computer
            <select
              aria-label="Computer"
              value={environmentId ?? ""}
              onChange={(event) =>
                void navigate({ to: "/hub", search: { environment: event.target.value } })
              }
            >
              {environments.map((env) => (
                <option key={env.environmentId} value={env.environmentId}>
                  {env.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <div className="work-home-content">
        <div className="work-home-heading">
          <div>
            <p className="work-kicker">{client ? "CLIENT" : "WORKSPACE"}</p>
            <h1>{client?.name ?? "Your work"}</h1>
            <p className="work-subtitle">
              {client
                ? "Projects, conversations and shared notes for this client."
                : "Find your work. Pick up where you left off."}
            </p>
          </div>
          <div className="hub-actions">
            {environmentId && (
              <Button variant="outline" onClick={() => setClientsOpen(true)}>
                <SettingsIcon />
                {client ? "Client settings" : "Manage clients"}
              </Button>
            )}
            {environmentId && client && (
              <HubChatButton
                environmentId={environmentId}
                projectId={null}
                clientId={client.id}
                clientName={client.name}
                disabled={client.archived}
              />
            )}
            {!client && environmentId && (
              <Button onClick={() => setEditor(newHubItem("project"))}>
                <PlusIcon />
                New project
              </Button>
            )}
          </div>
        </div>
        {client && (
          <div className="work-client-meta">
            <span>
              Default AI account <strong>{accountName}</strong>
            </span>
            <span>
              {client.defaultModelSelection ? "Client default" : "Uses your general default"}
            </span>
            {client.archived && <span>Archived</span>}
          </div>
        )}
        <div className="work-search">
          <SearchIcon size={19} />
          <Input
            autoFocus={focusSearch}
            aria-label="Search all work"
            placeholder={
              client ? `Search ${client.name}…` : "Search clients, projects, chats and notes…"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
              Clear
            </Button>
          )}
        </div>
        <p className="work-search-hint">
          {searching
            ? isSearching
              ? "Searching…"
              : "Matching names, chat titles and saved note content."
            : "Search names, chat titles, note content and tags."}
        </p>
        {(index.error || search.error) && (
          <p className="hub-error" role="alert">
            {index.error ?? search.error}
          </p>
        )}
        {index.isPending && (
          <p className="work-empty" role="status">
            Loading your work…
          </p>
        )}
        {!environmentId && (
          <p className="work-empty">Connect a computer in Settings to see your work.</p>
        )}
        {clientId && !client && !index.isPending && (
          <p className="work-empty">
            This client is unavailable. <Link to="/hub">Back to all work</Link>
          </p>
        )}
        {data && (
          <>
            {searching && data.clients.length > 0 && !client && (
              <section className="work-section">
                <h2>Clients</h2>
                <div className="work-client-shortcuts">
                  {data.clients.map((value) => (
                    <Link
                      key={value.id}
                      to="/hub"
                      search={{
                        ...(environmentId ? { environment: environmentId } : {}),
                        client: value.id,
                      }}
                    >
                      <Building2Icon size={18} />
                      {value.name}
                      <ChevronRightIcon size={16} />
                    </Link>
                  ))}
                </div>
              </section>
            )}
            <div className="work-columns">
              <section className="work-section">
                <div className="work-section-heading">
                  <h2>{searching || client ? "Projects" : "Clients & projects"}</h2>
                  {client && !client.archived && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditor(newHubItem("project", { clientIds: [client.id] }))}
                    >
                      <PlusIcon />
                      New project
                    </Button>
                  )}
                </div>
                {!searching &&
                  !client &&
                  data.clients.map((value) => (
                    <div className="work-client-block" key={value.id}>
                      <Link
                        className="work-client-link"
                        to="/hub"
                        search={{
                          ...(environmentId ? { environment: environmentId } : {}),
                          client: value.id,
                        }}
                      >
                        <Building2Icon size={18} />
                        <strong>{value.name}</strong>
                        <ChevronRightIcon size={16} />
                      </Link>
                      {data.projects
                        .filter((project) => project.clientIds[0] === value.id)
                        .map((project) => (
                          <button
                            className="work-project-link"
                            key={project.id}
                            onClick={() => void openProject(project)}
                          >
                            <FolderIcon size={16} />
                            <span>{project.title}</span>
                            <ChevronRightIcon size={14} />
                          </button>
                        ))}
                      {!data.projects.some((project) => project.clientIds[0] === value.id) && (
                        <p className="work-inline-empty">
                          Open client to start a chat or add a project.
                        </p>
                      )}
                    </div>
                  ))}
                {!searching &&
                  !client &&
                  data.projects.some((project) => !project.clientIds.length) && (
                    <h3 className="work-personal-label">Personal projects</h3>
                  )}
                {data.projects
                  .filter(
                    (project) =>
                      searching ||
                      client ||
                      !data.clients.some((value) => value.id === project.clientIds[0]),
                  )
                  .map((project) => (
                    <button
                      className="work-project-link"
                      key={project.id}
                      onClick={() => void openProject(project)}
                    >
                      <FolderIcon size={18} />
                      <span>{project.title}</span>
                      <ChevronRightIcon size={16} />
                    </button>
                  ))}
                {!data.projects.length && (client || !data.clients.length || searching) && (
                  <p className="work-inline-empty">
                    {searching
                      ? "No matching projects."
                      : "No projects yet. Start with a project name; folders can come later."}
                  </p>
                )}
              </section>
              <section className="work-section">
                <div className="work-section-heading">
                  <h2>{searching ? "Chats" : client ? "Client chats" : "Recent chats"}</h2>
                  {environmentId && !client && !searching && (
                    <HubChatButton environmentId={environmentId} projectId={null} />
                  )}
                </div>
                {(searching
                  ? data.chats
                  : client
                    ? data.chats.filter((item) => item.direct)
                    : data.chats.slice(0, 8)
                ).map(({ thread, context }) => (
                  <Link
                    className="work-chat-link"
                    key={thread.id}
                    to="/$environmentId/$threadId"
                    params={{ environmentId: thread.environmentId, threadId: thread.id }}
                  >
                    <MessageSquareIcon size={17} />
                    <span>
                      <strong>{thread.title}</strong>
                      <small>{context}</small>
                    </span>
                    <ArrowUpRightIcon size={14} />
                  </Link>
                ))}
                {!(searching || !client ? data.chats : data.chats.filter((item) => item.direct))
                  .length && (
                  <p className="work-inline-empty">
                    {searching
                      ? "No matching chat titles."
                      : client
                        ? "Start a chat here for questions across this client's projects."
                        : "Your recent conversations will appear here."}
                  </p>
                )}
                {searching && data.chats.length === 0 && (
                  <Button variant="ghost" size="sm" onClick={() => openCommandPalette({ query })}>
                    Search inside chats…
                  </Button>
                )}
              </section>
            </div>
            {(client || searching) && (
              <section className="work-section work-notes-section">
                <div className="work-section-heading">
                  <h2>{searching ? "Notes & tasks" : "Client notes"}</h2>
                  {client && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setEditor(newHubItem("note", { clientIds: [client.id], aiContext: true }))
                      }
                    >
                      <PlusIcon />
                      New note
                    </Button>
                  )}
                </div>
                {data.records
                  .filter(
                    (item) =>
                      searching || (item.kind === "note" && item.clientIds.includes(clientId!)),
                  )
                  .map((item) => (
                    <Link
                      className="work-chat-link"
                      key={item.id}
                      to="/notes"
                      search={{
                        ...(environmentId ? { environment: environmentId } : {}),
                        item: item.id,
                      }}
                    >
                      <NotebookPenIcon size={18} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.kind === "task"
                            ? "Task"
                            : item.aiContext
                              ? "Shared with AI"
                              : "Not shared with AI"}
                        </small>
                      </span>
                      <ChevronRightIcon size={16} />
                    </Link>
                  ))}
                {!data.records.some(
                  (item) =>
                    searching || (item.kind === "note" && item.clientIds.includes(clientId!)),
                ) && (
                  <p className="work-inline-empty">
                    {searching
                      ? "No matching notes or tasks."
                      : "Save client-wide information here. Notes marked Shared with AI are included in client chats."}
                  </p>
                )}
              </section>
            )}
            {searching && !isSearching && noResults && (
              <div className="work-empty">
                <h2>No results for “{query}”</h2>
                <p>Try a client name, a project, or a phrase from a note.</p>
                <Button variant="outline" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              </div>
            )}
            {!searching && !client && (
              <div className="work-home-footer">
                <Link to="/notes">
                  <NotebookPenIcon size={16} />
                  All notes & tasks
                </Link>
                <details>
                  <summary>Archived projects</summary>
                  {records
                    .filter((item) => item.kind === "project" && item.archived)
                    .map((item) => (
                      <Link
                        key={item.id}
                        to="/hub"
                        search={{
                          ...(environmentId ? { environment: environmentId } : {}),
                          item: item.id,
                        }}
                      >
                        {item.title}
                      </Link>
                    ))}
                  {!records.some((item) => item.kind === "project" && item.archived) && (
                    <p>No archived projects.</p>
                  )}
                </details>
              </div>
            )}
          </>
        )}
      </div>
      {clientsOpen && environmentId && (
        <ProjectClientsDialog
          environmentId={environmentId}
          initialClientId={clientId}
          onClose={() => setClientsOpen(false)}
        />
      )}
      {editor && environmentId && (
        <HubEditor
          initial={editor}
          environmentId={environmentId}
          items={records}
          clients={clients.filter((client) => client.environmentId === environmentId)}
          onSaved={saved}
          onClose={() => setEditor(null)}
        />
      )}
    </main>
  );
}
