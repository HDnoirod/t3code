import { createFileRoute, redirect } from "@tanstack/react-router";
import { HubPage } from "../components/workspaceHub/HubPage";

export const Route = createFileRoute("/notes")({
  validateSearch: (search: Record<string, unknown>): { environment?: string; item?: string } => ({
    ...(typeof search.environment === "string" ? { environment: search.environment } : {}),
    ...(typeof search.item === "string" ? { item: search.item } : {}),
  }),
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  component: NotesRoute,
});
function NotesRoute() {
  const search = Route.useSearch();
  return (
    <HubPage
      initialView="note"
      selectedEnvironment={search.environment}
      selectedItem={search.item}
    />
  );
}
