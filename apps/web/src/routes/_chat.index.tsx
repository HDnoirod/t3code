import { createFileRoute } from "@tanstack/react-router";
import { ProjectHome } from "../components/workspaceHub/ProjectHome";
import { HostedEmptyState } from "../components/HostedEmptyState";
import { useEnvironments } from "../state/environments";
function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();
  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedEmptyState />;
  }
  return <ProjectHome />;
}
export const Route = createFileRoute("/_chat/")({ component: ChatIndexRouteView });
