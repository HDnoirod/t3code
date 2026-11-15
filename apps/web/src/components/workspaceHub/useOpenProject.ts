import { useNavigate } from "@tanstack/react-router";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { hubEnsureProjectCommand, hubListQuery } from "../../state/workspaceHub";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { toastManager } from "../ui/toast";
import type { NavigationProject } from "./projectNavigation";

export function useOpenProject() {
  const ensure = useAtomCommand(hubEnsureProjectCommand, { reportFailure: false });
  const navigate = useNavigate();
  return async (project: NavigationProject, section?: "notes") => {
    return await (async () => {
      let id = project.id;
      if (project.sourceWorkspaceId) {
        const result = await ensure({
          environmentId: project.environmentId,
          input: { workspaceId: project.sourceWorkspaceId },
        });
        if (result._tag !== "Success") throw squashAtomCommandFailure(result);
        id = result.value.id;
        appAtomRegistry.refresh(
          hubListQuery({ environmentId: project.environmentId, input: { search: "" } }),
        );
      }
      await navigate({
        to: "/hub",
        search: { environment: project.environmentId, item: id, ...(section ? { section } : {}) },
      });
    })().catch((cause) => {
      toastManager.add({
        type: "error",
        title: "Could not open project",
        description: cause instanceof Error ? cause.message : "Try again.",
      });
    });
  };
}
