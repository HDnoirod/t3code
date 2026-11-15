import { useRef, useState } from "react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  hubEnsureProjectCommand,
  hubMoveProjectCommand,
  hubItemQuery,
  hubListQuery,
} from "../../state/workspaceHub";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import type { NavigationProject } from "./projectNavigation";
import { canMoveProject, projectMoveKey, type ProjectMoveTarget } from "./projectMove";

export function useMoveProject() {
  const ensure = useAtomCommand(hubEnsureProjectCommand, { reportFailure: false });
  const save = useAtomCommand(hubMoveProjectCommand, { reportFailure: false });
  const running = useRef(false);
  const [movingKey, setMovingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const move = async (project: NavigationProject, target: ProjectMoveTarget) => {
    if (running.current || !canMoveProject(project, target)) return false;
    running.current = true;
    setMovingKey(projectMoveKey(project));
    setNotice(null);
    let id = project.id;
    let version = project.version;
    try {
      if (project.sourceWorkspaceId) {
        const resolved = await ensure({
          environmentId: project.environmentId,
          input: { workspaceId: project.sourceWorkspaceId },
        });
        if (resolved._tag !== "Success") throw squashAtomCommandFailure(resolved);
        id = resolved.value.id;
        version = resolved.value.version;
      }
      const result = await save({
        environmentId: project.environmentId,
        input: { id, version, clientId: target.clientId },
      });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      setNotice({ text: `Moved ${project.title} to ${target.title}.`, error: false });
      return true;
    } catch (cause) {
      setNotice({
        text: cause instanceof Error ? cause.message : "Could not move the project. Try again.",
        error: true,
      });
      return false;
    } finally {
      // Refresh on failure too: a version conflict should be retryable from fresh state.
      appAtomRegistry.refresh(
        hubListQuery({ environmentId: project.environmentId, input: { search: "" } }),
      );
      if (!id.startsWith("folder:"))
        appAtomRegistry.refresh(
          hubItemQuery({ environmentId: project.environmentId, input: { id } }),
        );
      running.current = false;
      setMovingKey(null);
    }
  };
  return { move, movingKey, notice };
}
