import { useNowMinute } from "../../hooks/useNowMinute";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import { useEnvironments } from "../../state/environments";
import { timeTrackingQuery } from "../../state/timeTracking";
import { dateKey } from "../timeTracking/calendar";

export function useHubClients() {
  const nowMinute = useNowMinute();
  const { environments } = useEnvironments();
  const day = dateKey(new Date(`${nowMinute}:00Z`));
  const query = Atom.make((get) =>
    environments.flatMap(({ environmentId }) => {
      const result = get(timeTrackingQuery({ environmentId, input: { from: day, to: day } }));
      return (Option.getOrNull(AsyncResult.value(result))?.clients ?? []).map((client) => ({
        ...client,
        environmentId,
      }));
    }),
  );
  return useAtomValue(query);
}
