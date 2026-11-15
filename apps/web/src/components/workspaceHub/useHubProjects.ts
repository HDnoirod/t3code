import { useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { useEnvironments } from "../../state/environments";
import { hubListQuery } from "../../state/workspaceHub";
import { useProjects, useThreadShells } from "../../state/entities";
import { projectChatOwners, unifiedProjects } from "./projectNavigation";

export function useHubProjects() {
  const { environments } = useEnvironments();
  const query = useMemo(
    () =>
      Atom.make((get) =>
        environments.flatMap(({ environmentId }) => {
          const result = get(hubListQuery({ environmentId, input: { search: "" } }));
          return (Option.getOrNull(AsyncResult.value(result))?.items ?? [])
            .filter((item) => item.kind === "project")
            .map((item) => ({ ...item, environmentId }));
        }),
      ),
    [environments],
  );
  const savedProjects = useAtomValue(query);
  const folders = useProjects();
  const threads = useThreadShells();
  const projects = useMemo(
    () => unifiedProjects(savedProjects, folders, threads),
    [savedProjects, folders, threads],
  );
  const owners = useMemo(() => projectChatOwners(projects, threads), [projects, threads]);
  return { projects, owners };
}
