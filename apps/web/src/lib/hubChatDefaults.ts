import type { ScopedProjectRef } from "@t3tools/contracts";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { hubChatDefaultsQuery } from "../state/workspaceHub";

export async function readHubChatDefault(project: ScopedProjectRef) {
  const atom = hubChatDefaultsQuery({
    environmentId: project.environmentId,
    input: { workspaceId: project.projectId },
  });
  const result = await executeAtomQuery(appAtomRegistry, atom, {
    reportFailure: false,
    refresh: true,
  });
  if (result._tag !== "Success") throw squashAtomCommandFailure(result);
  if (result.value.unavailableReason) throw new Error(result.value.unavailableReason);
  return result.value.modelSelection;
}
