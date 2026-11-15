import { useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { useEnvironments } from "../../state/environments";
import { timeTrackingQuery } from "../../state/timeTracking";
import { dateKey } from "../timeTracking/calendar";

export function useHubClients() {
  const { environments } = useEnvironments();
  const day = dateKey(new Date());
  const query = useMemo(
    () =>
      Atom.make((get) =>
        environments.flatMap(({ environmentId }) => {
          const result = get(timeTrackingQuery({ environmentId, input: { from: day, to: day } }));
          return (Option.getOrNull(AsyncResult.value(result))?.clients ?? []).map((client) => ({
            ...client,
            environmentId,
          }));
        }),
      ),
    [environments, day],
  );
  return useAtomValue(query);
}
