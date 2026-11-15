import { randomUUID } from "../../lib/utils";
import { ProjectEditor } from "./ProjectEditor";
import { WorkingFolderPicker } from "./WorkingFolderPicker";
import { workingFolderPath, type WorkingFolderChoice } from "./workingFolder";
import { projectEnvironment } from "../../state/projects";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
} from "@t3tools/client-runtime/state/projects";
import { newProjectId } from "../../lib/utils";
import { projectWorkingFolderIds } from "./projectNavigation";
import { useEnvironments } from "../../state/environments";
import type {
  EnvironmentId,
  HubItem,
  HubSaveInput,
  HubSummary,
  TimeTrackingClient,
} from "@t3tools/contracts";
import { HubPriority, HubStatus } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { readProjects, useProjects, useThreadShells } from "../../state/entities";
import { isStandaloneChatWorkspace } from "@t3tools/contracts";
import { useAtomCommand } from "../../state/use-atom-command";
import { hubSaveCommand } from "../../state/workspaceHub";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { downloadFile, safeFilename } from "./hub";

export function LinkPicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: string; title: string }[];
  value: readonly string[];
  onChange: (value: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const choices = [
    ...options,
    ...value
      .filter((id) => !options.some((option) => option.id === id))
      .map((id) => ({ id, title: `Unavailable item (${id})` })),
  ];
  return (
    <fieldset className="hub-link-picker">
      <legend>
        {label} {value.length > 0 && <span>· {value.length} linked</span>}
      </legend>
      {choices.length > 6 && (
        <Input
          aria-label={`Search ${label.toLowerCase()}`}
          placeholder="Find…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      <div className="hub-link-options">
        {choices
          .filter((option) => option.title.toLowerCase().includes(search.toLowerCase()))
          .map((option) => (
            <label key={option.id}>
              <input
                type="checkbox"
                checked={value.includes(option.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, option.id]
                      : value.filter((id) => id !== option.id),
                  )
                }
              />
              <span>{option.title}</span>
            </label>
          ))}
        {choices.length === 0 && <p className="hub-muted">Nothing to link yet.</p>}
      </div>
    </fieldset>
  );
}

const markdownComponents: Components = {
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};
export function HubMarkdown({ children }: { children: string }) {
  return (
    <div className="hub-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

function ItemEditor({
  initial,
  environmentId,
  items,
  clients,
  onSaved,
  onClose,
}: {
  initial: HubSaveInput;
  environmentId: EnvironmentId;
  items: readonly HubSummary[];
  clients: readonly TimeTrackingClient[];
  onSaved: (item: HubItem) => void;
  onClose: () => void;
}) {
  const { environments } = useEnvironments();
  const environmentName =
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    "this environment";
  const [draft, setDraft] = useState(initial);
  const [resourceKeys, setResourceKeys] = useState(() => initial.resources.map(() => randomUUID()));
  const titleInput = useRef<HTMLInputElement>(null);
  const Metadata = draft.kind === "note" ? "details" : "div";
  const [tab, setTab] = useState<"write" | "links" | "preview">("write");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const save = useAtomCommand(hubSaveCommand, { reportFailure: false });
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !isStandaloneChatWorkspace(project.id),
  );
  const threads = useThreadShells().filter((thread) => thread.environmentId === environmentId);
  const createFolder = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const folderRequests = useRef(new Map<string, ReturnType<typeof newProjectId>>());
  const [folder, setFolder] = useState<WorkingFolderChoice>({
    mode: "linked",
    location: "",
    name: "",
  });
  const workingIds = projectWorkingFolderIds(
    { workspaceIds: draft.workspaceIds, chatIds: draft.chatIds ?? [] },
    threads,
  );
  const dirty = folder.mode !== "linked" || JSON.stringify(draft) !== JSON.stringify(initial);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the browser unload warning while the editor contains unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const close = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  function patch<K extends keyof HubSaveInput>(key: K, value: HubSaveInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  const submit = async () => {
    if (busy) return;
    if (!draft.title.trim()) {
      setError("Give this item a title.");
      setTab("write");
      return;
    }
    if (draft.body.length > 100000) {
      setError(
        "This note exceeds 100,000 characters. Split it into smaller notes, or export the draft to keep the full text.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    return await (async () => {
      let workspaceIds = draft.workspaceIds;
      if (draft.kind === "project" && folder.mode !== "linked") {
        if (
          !folder.location.trim() ||
          (folder.mode === "create" &&
            (!folder.name.trim() ||
              /[/\\]/.test(folder.name) ||
              [".", ".."].includes(folder.name.trim())))
        ) {
          throw new Error("Choose a location and a valid folder name.");
        }
        const path = workingFolderPath(folder);
        const existing = findProjectByPath(
          readProjects().filter((project) => project.environmentId === environmentId),
          path,
        );
        const workspaceId = existing?.id ?? folderRequests.current.get(path) ?? newProjectId();
        folderRequests.current.set(path, workspaceId);
        if (!existing) {
          const created = await createFolder({
            environmentId,
            input: {
              projectId: workspaceId,
              title: inferProjectTitleFromPath(path),
              workspaceRoot: path,
              createWorkspaceRootIfMissing: folder.mode === "create",
              defaultModelSelection: null,
            },
          });
          if (created._tag !== "Success") throw squashAtomCommandFailure(created);
        }
        workspaceIds = [workspaceId, ...workspaceIds.filter((id) => id !== workspaceId)];
        setDraft((current) => ({ ...current, workspaceIds }));
        setFolder({ mode: "linked", location: "", name: "" });
      }
      const result = await save({
        environmentId,
        input: {
          ...draft,
          workspaceIds,
          title: draft.title.trim(),
          tags: draft.tags.map((tag) => tag.trim()).filter(Boolean),
        },
      });
      if (result._tag === "Success") onSaved(result.value);
      else {
        const failure = squashAtomCommandFailure(result);
        setError(
          failure instanceof Error ? failure.message : "Could not save. Your draft has been kept.",
        );
      }
    })()
      .catch((cause) => {
        setError(
          cause instanceof Error ? cause.message : "Could not save. Your draft has been kept.",
        );
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup
        className="max-w-3xl! overflow-y-auto"
        showCloseButton={false}
        initialFocus={titleInput}
      >
        <DialogHeader>
          <DialogTitle>
            {initial.version ? "Edit" : "New"} {draft.kind}
          </DialogTitle>
          <DialogDescription>
            Saving in {environmentName}.{" "}
            {draft.kind === "project"
              ? "Keep chats and notes together, and choose where the agent works with your files."
              : "Link this item to several projects; each will show the same saved version."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="hub-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy}>
            <div className="hub-tabs" role="group" aria-label="Editor views">
              {(["write", "links", "preview"] as const).map((view) => (
                <Button
                  key={view}
                  type="button"
                  size="sm"
                  variant={tab === view ? "secondary" : "ghost"}
                  aria-pressed={tab === view}
                  onClick={() => setTab(view)}
                >
                  {view === "write" ? "Write" : view === "links" ? "Organize" : "Preview"}
                </Button>
              ))}
            </div>
            {tab === "write" && (
              <div className="hub-form-grid">
                <div className="hub-filing-summary">
                  <div>
                    <span>Save to</span>
                    <strong>
                      {[
                        ...draft.clientIds.map(
                          (id) =>
                            clients.find((client) => client.id === id)?.name ??
                            "Unavailable client",
                        ),
                        ...draft.projectIds.map(
                          (id) =>
                            items.find((item) => item.id === id)?.title ?? "Unavailable project",
                        ),
                      ].join(" · ") || "Inbox · unfiled"}
                    </strong>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => setTab("links")}>
                    Change
                  </Button>
                </div>
                <label className="hub-field">
                  Title
                  <Input
                    ref={titleInput}
                    required
                    maxLength={200}
                    value={draft.title}
                    placeholder={
                      draft.kind === "note" ? "A thought worth keeping" : "Give it a name"
                    }
                    onChange={(event) => patch("title", event.target.value)}
                  />
                </label>
                {draft.kind === "project" && (
                  <>
                    <WorkingFolderPicker
                      environmentId={environmentId}
                      value={folder}
                      onChange={setFolder}
                    />
                    <label className="hub-field">
                      Default working folder
                      <select
                        className="hub-select"
                        value={draft.workspaceIds[0] ?? ""}
                        onChange={(event) =>
                          patch(
                            "workspaceIds",
                            event.target.value
                              ? [
                                  event.target.value,
                                  ...draft.workspaceIds.filter((id) => id !== event.target.value),
                                ]
                              : [],
                          )
                        }
                      >
                        <option value="">
                          {workingIds.length
                            ? "Use the folder from existing chats"
                            : "T3 managed folder (created when needed)"}
                        </option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.title} · {project.workspaceRoot}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <label className="hub-field">
                  {draft.kind === "project"
                    ? "Project brief"
                    : draft.kind === "task"
                      ? "Details & next steps"
                      : "Note"}
                  <textarea
                    className="hub-textarea hub-writing"
                    rows={12}
                    maxLength={100000}
                    value={draft.body}
                    onChange={(event) => patch("body", event.target.value)}
                    placeholder="Write in Markdown. Use - [ ] for a checklist."
                  />
                </label>
                {draft.kind === "note" && (
                  <label className="hub-context-choice">
                    <input
                      type="checkbox"
                      checked={draft.aiContext ?? false}
                      onChange={(event) => patch("aiContext", event.target.checked)}
                    />
                    <span>
                      <strong>Share with AI</strong>
                      <small>
                        Include this note in chats for its linked clients and projects.
                        {draft.projectIds.length === 0 && draft.clientIds.length === 0
                          ? " Choose a client or project using Change above."
                          : ""}
                      </small>
                    </span>
                  </label>
                )}
                <Metadata className="hub-editor-options">
                  {draft.kind === "note" && <summary>Tags, collection & more</summary>}
                  <div className="hub-form-row">
                    <label className="hub-field">
                      Tags
                      <Input
                        value={draft.tags.join(",")}
                        maxLength={1200}
                        placeholder="meeting, ideas, reference"
                        onChange={(event) => patch("tags", event.target.value.split(","))}
                      />
                    </label>
                    {draft.kind === "note" ? (
                      <label className="hub-field">
                        Collection
                        <Input
                          value={draft.folder}
                          maxLength={100}
                          placeholder="Optional, e.g. Meeting notes"
                          onChange={(event) => patch("folder", event.target.value)}
                        />
                      </label>
                    ) : (
                      <label className="hub-field">
                        Status
                        <select
                          className="hub-select"
                          value={draft.status}
                          onChange={(event) => {
                            const status = HubStatus.literals.find(
                              (value) => value === event.target.value,
                            );
                            if (status) patch("status", status);
                          }}
                        >
                          {(draft.kind === "task"
                            ? ["todo", "doing", "waiting", "done"]
                            : ["active", "paused", "complete"]
                          ).map((status) => (
                            <option key={status} value={status}>
                              {status === "todo"
                                ? "To do"
                                : status === "doing"
                                  ? "In progress"
                                  : status[0]!.toUpperCase() + status.slice(1)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {draft.kind === "task" && (
                    <div className="hub-form-row">
                      <label className="hub-field">
                        Due date
                        <Input
                          type="date"
                          value={draft.dueDate ?? ""}
                          onChange={(event) => patch("dueDate", event.target.value || null)}
                        />
                      </label>
                      <label className="hub-field">
                        Priority
                        <select
                          className="hub-select"
                          value={draft.priority}
                          onChange={(event) => {
                            const priority = HubPriority.literals.find(
                              (value) => value === event.target.value,
                            );
                            if (priority) patch("priority", priority);
                          }}
                        >
                          {HubPriority.literals.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                  {draft.kind === "project" && (
                    <label className="hub-field">
                      Contacts
                      <textarea
                        className="hub-textarea"
                        rows={3}
                        maxLength={10000}
                        value={draft.contacts}
                        placeholder="Names, roles, email addresses and phone numbers"
                        onChange={(event) => patch("contacts", event.target.value)}
                      />
                    </label>
                  )}
                  <label className="hub-check">
                    <input
                      type="checkbox"
                      checked={draft.pinned}
                      onChange={(event) => patch("pinned", event.target.checked)}
                    />
                    Pin for easy access
                  </label>
                </Metadata>
              </div>
            )}
            {tab === "links" && (
              <div className="hub-form-grid">
                <p className="hub-muted">
                  Choose where this {draft.kind} belongs. Select more than one project to keep a
                  single shared copy.
                </p>
                <LinkPicker
                  label="Projects"
                  options={items.filter((item) => item.kind === "project" && item.id !== draft.id)}
                  value={draft.projectIds}
                  onChange={(value) => patch("projectIds", value)}
                />
                <LinkPicker
                  label="Clients"
                  options={clients.map((client) => ({
                    id: client.id,
                    title: `${client.name}${client.archived ? " (archived)" : ""}`,
                  }))}
                  value={draft.clientIds}
                  onChange={(value) => patch("clientIds", value)}
                />
                <details className="hub-editor-options">
                  <summary>References & attachments</summary>
                  <LinkPicker
                    label="Related notes & tasks"
                    options={items.filter(
                      (item) => item.kind !== "project" && item.id !== draft.id,
                    )}
                    value={draft.relatedIds}
                    onChange={(value) => patch("relatedIds", value)}
                  />
                  <LinkPicker
                    label="Working folders"
                    options={projects.map((project) => ({ id: project.id, title: project.title }))}
                    value={draft.workspaceIds}
                    onChange={(value) => patch("workspaceIds", value)}
                  />
                  {draft.kind === "project" && (
                    <>
                      <LinkPicker
                        label="Project chats"
                        options={threads.map((thread) => ({ id: thread.id, title: thread.title }))}
                        value={draft.chatIds ?? []}
                        onChange={(value) => patch("chatIds", value)}
                      />
                      <p className="hub-muted">
                        These chats receive the project brief and notes marked as AI context when
                        you send a message. Removing a chat keeps its history.
                      </p>
                    </>
                  )}
                  <LinkPicker
                    label="Chat references (no automatic context)"
                    options={threads.map((thread) => ({ id: thread.id, title: thread.title }))}
                    value={draft.threadIds}
                    onChange={(value) => patch("threadIds", value)}
                  />
                  <fieldset className="hub-link-picker">
                    <legend>Files & reference links</legend>
                    <p className="hub-muted">
                      Add a document URL, shared drive link, or website. Local project files are
                      available through linked working folders.
                    </p>
                    {draft.resources.map((resource, index) => (
                      <div className="hub-resource-edit" key={resourceKeys[index]}>
                        <Input
                          aria-label={`Link ${index + 1} label`}
                          placeholder="Label"
                          maxLength={200}
                          value={resource.label}
                          onChange={(event) =>
                            patch(
                              "resources",
                              draft.resources.map((value, i) =>
                                i === index ? { ...value, label: event.target.value } : value,
                              ),
                            )
                          }
                        />
                        <Input
                          aria-label={`Link ${index + 1} URL`}
                          type="url"
                          placeholder="https://…"
                          value={resource.url}
                          onChange={(event) =>
                            patch(
                              "resources",
                              draft.resources.map((value, i) =>
                                i === index ? { ...value, url: event.target.value } : value,
                              ),
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setResourceKeys(resourceKeys.filter((_, i) => i !== index));
                            patch(
                              "resources",
                              draft.resources.filter((_, i) => i !== index),
                            );
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={draft.resources.length >= 100}
                      onClick={() => {
                        setResourceKeys([...resourceKeys, randomUUID()]);
                        patch("resources", [...draft.resources, { label: "", url: "" }]);
                      }}
                    >
                      Add link
                    </Button>
                  </fieldset>
                </details>
              </div>
            )}
            {tab === "preview" && (
              <div className="hub-preview">
                <h2>{draft.title || "Untitled"}</h2>
                <HubMarkdown>{draft.body || "Nothing written yet."}</HubMarkdown>
              </div>
            )}
          </fieldset>
          {error && (
            <p className="hub-error" role="alert">
              {error}
            </p>
          )}
          {discard && (
            <div className="hub-notice" role="alert">
              <p>Discard your unsaved changes?</p>
              <div className="hub-actions">
                <Button type="button" variant="outline" onClick={() => setDiscard(false)}>
                  Keep editing
                </Button>
                <Button type="button" variant="destructive" onClick={onClose}>
                  Discard changes
                </Button>
              </div>
            </div>
          )}
          <div className="hub-editor-footer">
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                downloadFile(
                  `${safeFilename(draft.title)}.md`,
                  `# ${draft.title}\n\n${draft.body}`,
                  "text/markdown;charset=utf-8",
                )
              }
            >
              Export draft
            </Button>
            <div className="hub-actions">
              <Button type="button" variant="outline" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function HubEditor(props: Parameters<typeof ItemEditor>[0]) {
  return props.initial.kind === "project" ? (
    <ProjectEditor {...props} />
  ) : (
    <ItemEditor {...props} />
  );
}
