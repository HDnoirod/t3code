import type { EnvironmentId } from "@t3tools/contracts";
import type { NavigationProject } from "./projectNavigation";

export type ProjectMoveTarget = {
  environmentId: EnvironmentId;
  clientId: string | null;
  title: string;
  archived: boolean;
};

export const projectMoveKey = (project: Pick<NavigationProject, "environmentId" | "id">) =>
  `${project.environmentId}:${project.id}`;

export function canMoveProject(project: NavigationProject | null, target: ProjectMoveTarget) {
  return (
    project !== null &&
    !project.archived &&
    !target.archived &&
    project.environmentId === target.environmentId &&
    (project.clientIds[0] ?? null) !== target.clientId
  );
}

export function clientGroupKey(target: Pick<ProjectMoveTarget, "environmentId" | "clientId">) {
  return `${target.environmentId}:${target.clientId ? `client:${target.clientId}` : "personal"}`;
}
