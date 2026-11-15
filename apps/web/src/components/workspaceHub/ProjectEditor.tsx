import { useEffect, useRef, useState } from "react";
import { isStandaloneChatWorkspace } from "@t3tools/contracts";
import type { EnvironmentId, HubItem, HubSaveInput, TimeTrackingClient } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useProjects, useThreadShells, readProjects } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { hubSaveCommand } from "../../state/workspaceHub";
import { projectEnvironment } from "../../state/projects";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
} from "@t3tools/client-runtime/state/projects";
import { newProjectId } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { WorkingFolderPicker } from "./WorkingFolderPicker";
import { workingFolderPath, type WorkingFolderChoice } from "./workingFolder";
import { projectWorkingFolderIds } from "./projectNavigation";

export function ProjectEditor({
  initial,
  environmentId,
  clients,
  onSaved,
  onClose,
}: {
  initial: HubSaveInput;
  environmentId: EnvironmentId;
  clients: readonly TimeTrackingClient[];
  onSaved: (item: HubItem) => void;
  onClose: () => void;
}) {
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !isStandaloneChatWorkspace(project.id),
  );
  const threads = useThreadShells().filter((thread) => thread.environmentId === environmentId);
  const [startingDraft] = useState(() => ({
    ...initial,
    workspaceIds: projectWorkingFolderIds(
      { workspaceIds: initial.workspaceIds, chatIds: initial.chatIds ?? [] },
      threads,
    ),
  }));
  const [draft, setDraft] = useState(startingDraft);
  const usedFolders = new Set(
    threads
      .filter((thread) => (initial.chatIds ?? []).includes(thread.id))
      .map((thread) => String(thread.projectId)),
  );
  const [adding, setAdding] = useState(false);
  const [folder, setFolder] = useState<WorkingFolderChoice>({
    mode: "existing",
    location: "",
    name: "",
  });
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useAtomCommand(hubSaveCommand, { reportFailure: false });
  const createFolder = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const request = useRef(new Map<string, ReturnType<typeof newProjectId>>());
  const dirty =
    draft.title !== initial.title ||
    draft.body !== initial.body ||
    draft.pinned !== initial.pinned ||
    JSON.stringify(draft.workspaceIds) !== JSON.stringify(startingDraft.workspaceIds) ||
    JSON.stringify(draft.clientIds) !== JSON.stringify(initial.clientIds) ||
    adding;
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
  const submit = async (archivedOverride?: boolean) => {
    const archived = archivedOverride ?? draft.archived;
    if (busy) return;
    setBusy(true);
    setError(null);
    return await (async () => {
      if (!draft.title.trim()) throw new Error("Give the project a name.");
      let workspaceIds = draft.workspaceIds;
      if (adding && folder.mode !== "linked") {
        if (
          !folder.location.trim() ||
          (folder.mode === "create" &&
            (!folder.name.trim() ||
              /[/\\]/.test(folder.name) ||
              [".", ".."].includes(folder.name.trim())))
        )
          throw new Error("Choose a folder location and name.");
        const path = workingFolderPath(folder);
        const existing = findProjectByPath(
          readProjects().filter((project) => project.environmentId === environmentId),
          path,
        );
        const id = existing?.id ?? request.current.get(path) ?? newProjectId();
        request.current.set(path, id);
        if (!existing) {
          const result = await createFolder({
            environmentId,
            input: {
              projectId: id,
              title: inferProjectTitleFromPath(path),
              workspaceRoot: path,
              createWorkspaceRootIfMissing: folder.mode === "create",
              defaultModelSelection: null,
            },
          });
          if (result._tag !== "Success") throw squashAtomCommandFailure(result);
        }
        workspaceIds = [...new Set([...workspaceIds, id])];
        setDraft((value) => ({ ...value, workspaceIds }));
        setAdding(false);
      }
      const result = await save({
        environmentId,
        input: { ...draft, title: draft.title.trim(), workspaceIds, archived },
      });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      onSaved(result.value);
    })()
      .catch((cause) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not save the project. Your changes are still here.",
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
      <DialogPopup className="max-w-2xl! overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial.version ? "Project settings" : "New project"}</DialogTitle>
          <DialogDescription>
            A project keeps its chats, notes and folders together.
          </DialogDescription>
        </DialogHeader>
        <form
          className="hub-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy} className="hub-form-grid">
            <label className="hub-field">
              Project name
              <Input
                autoFocus
                required
                maxLength={200}
                placeholder="HumanOS"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label className="hub-field">
              Client
              <select
                className="hub-select"
                value={draft.clientIds[0] ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, clientIds: event.target.value ? [event.target.value] : [] })
                }
              >
                <option value="">Personal project (no client)</option>
                {clients
                  .filter((client) => !client.archived || draft.clientIds.includes(client.id))
                  .map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                      {client.archived ? " (archived)" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label className="hub-field">
              What should the AI know about this project?
              <textarea
                className="hub-textarea"
                rows={3}
                maxLength={100000}
                placeholder="Goals, background, or instructions for every chat…"
                value={draft.body}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              />
            </label>
            <div className="hub-section-heading">
              <h3>Folders</h3>
              <Button type="button" size="sm" variant="outline" onClick={() => setAdding(!adding)}>
                {adding ? "Cancel adding" : "Add folder"}
              </Button>
            </div>
            {draft.workspaceIds.map((id, index) => {
              const folder = projects.find((project) => project.id === id);
              return (
                <div className="project-editor-folder" key={id}>
                  <div>
                    <strong>{folder?.title ?? "Unavailable folder"}</strong>
                    <small>{folder?.workspaceRoot}</small>
                    {index === 0 && <small>New chats start here</small>}
                    {usedFolders.has(id) && <small>Used by existing chats</small>}
                  </div>
                  <div className="hub-actions">
                    {index > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            workspaceIds: [
                              id,
                              ...draft.workspaceIds.filter((value) => value !== id),
                            ],
                          })
                        }
                      >
                        Use first
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={usedFolders.has(id)}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          workspaceIds: draft.workspaceIds.filter((value) => value !== id),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
            {!draft.workspaceIds.length && !adding && (
              <p className="hub-muted">
                Add folders now or later. T3 will create a private working folder if you start a
                chat without one.
              </p>
            )}
            {adding && (
              <>
                <label className="hub-field">
                  Already in T3
                  <select
                    className="hub-select"
                    value=""
                    onChange={(event) => {
                      if (event.target.value) {
                        setDraft({
                          ...draft,
                          workspaceIds: [...new Set([...draft.workspaceIds, event.target.value])],
                        });
                        setAdding(false);
                      }
                    }}
                  >
                    <option value="">Choose a folder…</option>
                    {projects
                      .filter((project) => !draft.workspaceIds.includes(project.id))
                      .map((project) => (
                        <option value={project.id} key={project.id}>
                          {project.title}
                        </option>
                      ))}
                  </select>
                </label>
                <WorkingFolderPicker
                  environmentId={environmentId}
                  value={folder}
                  onChange={setFolder}
                />
              </>
            )}
            <label className="hub-field">
              <span>
                <input
                  type="checkbox"
                  checked={draft.pinned}
                  onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })}
                />{" "}
                Keep this project at the top of the sidebar
              </span>
            </label>
          </fieldset>
          {error && (
            <p className="hub-error" role="alert">
              {error}
            </p>
          )}
          {discard && (
            <p className="hub-notice">
              Discard unsaved changes?{" "}
              <Button type="button" variant="ghost" onClick={onClose}>
                Discard
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDiscard(false)}>
                Keep editing
              </Button>
            </p>
          )}
          <div className="hub-actions">
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
            {initial.version > 0 && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => void submit(!initial.archived)}
              >
                {initial.archived ? "Restore project" : "Archive project"}
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : initial.version ? "Save project" : "Create project"}
            </Button>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
