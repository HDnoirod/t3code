import { useHubProjects } from "./useHubProjects";
import { useOpenProject } from "./useOpenProject";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { BookOpenIcon, FolderKanbanIcon } from "lucide-react";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  hubChatContextQuery,
  hubEnsureProjectCommand,
  hubGetCommand,
  hubListQuery,
  hubSaveCommand,
} from "../../state/workspaceHub";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import "./workspaceHub.css";

export function HubChatContext({ threadRef }: { threadRef: ScopedThreadRef }) {
  const { environmentId, threadId } = threadRef;
  const index = useEnvironmentQuery(hubListQuery({ environmentId, input: { search: "" } }));
  const { owners, projects: allProjects } = useHubProjects();
  const projects = allProjects.filter((project) => project.environmentId === environmentId);
  const owner = owners.get(scopedThreadKey(threadRef));
  const openProject = useOpenProject();
  const attached = projects.filter(
    (item) => item.chatIds.includes(threadId) || item.id === owner?.id,
  );
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ensure = useAtomCommand(hubEnsureProjectCommand, { reportFailure: false });
  const get = useAtomCommand(hubGetCommand, { reportFailure: false });
  const save = useAtomCommand(hubSaveCommand, { reportFailure: false });
  const context = useEnvironmentQuery(
    open ? hubChatContextQuery({ environmentId, input: { threadId } }) : null,
  );
  const refreshContext = context.refresh;
  useEffect(() => {
    if (open && index.dataUpdatedAt !== null) refreshContext();
  }, [open, index.dataUpdatedAt, refreshContext]);
  const update = async (projectId: string, include: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const target = projects.find((project) => project.id === projectId);
      let id = projectId;
      if (target?.sourceWorkspaceId) {
        const resolved = await ensure({
          environmentId,
          input: { workspaceId: target.sourceWorkspaceId },
        });
        if (resolved._tag !== "Success") throw squashAtomCommandFailure(resolved);
        id = resolved.value.id;
      }
      const current = await get({ environmentId, input: { id } });
      if (current._tag !== "Success") throw squashAtomCommandFailure(current);
      const result = await save({
        environmentId,
        input: {
          ...current.value,
          excludedChatIds: include
            ? (current.value.excludedChatIds ?? []).filter((id) => id !== threadId)
            : [...new Set([...(current.value.excludedChatIds ?? []), threadId])],
          chatIds: include
            ? [...new Set([...current.value.chatIds, threadId])]
            : current.value.chatIds.filter((id) => id !== threadId),
        },
      });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      index.refresh();
      context.refresh();
      setSelected("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this chat.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="hub-chat-context-bar">
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <FolderKanbanIcon />
          AI context
        </Button>
        {owner && (
          <Button size="sm" variant="ghost" onClick={() => void openProject(owner, "notes")}>
            <BookOpenIcon />
            Project notes
          </Button>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              {context.data?.client
                ? `${context.data.client.name} · AI context`
                : "Project & AI context"}
            </DialogTitle>
            <DialogDescription>
              {context.data?.client
                ? "This client chat includes a short project overview and client notes marked for AI context. Add projects below to include their notes and working folders. "
                : ""}
              Each message includes the latest project background, selected notes and folder
              overviews. Unlinking a project stops future inclusion; content already sent remains in
              the conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="hub-context-dialog">
            {(error || index.error || context.error) && (
              <p className="hub-error" role="alert">
                {error ?? index.error ?? context.error}
              </p>
            )}
            {attached.map((project) => (
              <div className="hub-context-membership" key={project.id}>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setOpen(false);
                    void openProject(project);
                  }}
                >
                  {project.title}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void update(project.id, false)}
                >
                  Unlink chat
                </Button>
              </div>
            ))}
            <div className="hub-actions">
              <select
                className="hub-select"
                aria-label="Project for this chat"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">Choose a project…</option>
                {projects
                  .filter((project) => !attached.some((item) => item.id === project.id))
                  .map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
              </select>
              <Button
                size="sm"
                disabled={!selected || busy}
                onClick={() => void update(selected, true)}
              >
                Add chat
              </Button>
            </div>
            {!projects.length && (
              <Link to="/hub" search={{ create: true }} onClick={() => setOpen(false)}>
                Create a project →
              </Link>
            )}
            <h3>Context sent with your next message</h3>
            {context.isPending ? (
              <p className="hub-muted">Loading saved context…</p>
            ) : (
              <>
                {context.data?.truncated && (
                  <p className="hub-context-label">
                    Some context is shortened. The preview below shows the current content; folder
                    changes are picked up when you send.
                  </p>
                )}
                {context.data?.text ? (
                  <pre className="hub-context-preview">{context.data.text}</pre>
                ) : (
                  <p className="hub-muted">No project brief or AI notes selected yet.</p>
                )}
              </>
            )}
            <p className="hub-muted">
              This content goes to the provider you choose when you send a message. Other chats and
              unmarked notes are not included. Folder overviews include file names and short README
              excerpts; the agent reads other files as needed.
            </p>
          </div>
        </DialogPopup>
      </Dialog>
    </>
  );
}
