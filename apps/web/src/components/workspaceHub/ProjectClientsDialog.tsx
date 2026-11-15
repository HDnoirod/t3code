import { useNowMinute } from "../../hooks/useNowMinute";
import type { EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ClientsDialog } from "../timeTracking/ClientsDialog";
import type { SaveTimeChange } from "../timeTracking/TimeEntryDialog";
import { dateKey } from "../timeTracking/calendar";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { timeTrackingMutation, timeTrackingQuery } from "../../state/timeTracking";

export function ProjectClientsDialog({
  environmentId,
  onClose,
  initialClientId,
}: {
  environmentId: EnvironmentId;
  onClose: () => void;
  initialClientId?: string | undefined;
}) {
  const nowMinute = useNowMinute();
  const day = dateKey(new Date(`${nowMinute}:00Z`));
  const query = useEnvironmentQuery(
    timeTrackingQuery({ environmentId, input: { from: day, to: day } }),
  );
  const mutate = useAtomCommand(timeTrackingMutation, { reportFailure: false });
  const save: SaveTimeChange = async (input) => {
    return await (async () => {
      const result = await mutate({ environmentId, input });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      query.refresh();
      return null;
    })().catch((cause) => {
      return cause instanceof Error ? cause.message : "Could not save the client.";
    });
  };
  return (
    <ClientsDialog
      key={`${initialClientId ?? "new"}:${Boolean(query.data)}`}
      environmentId={environmentId}
      clients={query.data?.clients ?? []}
      onSave={save}
      onClose={onClose}
      initialClientId={initialClientId}
    />
  );
}
