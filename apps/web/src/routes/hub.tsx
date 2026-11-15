/* oxlint-disable t3code/no-rpc-permission-bypass -- The client fields in this view identify business customers; RPC calls use permission-aware commands. */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ProjectHome } from "../components/workspaceHub/ProjectHome";

export const Route = createFileRoute("/hub")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    environment?: string;
    item?: string;
    create?: boolean;
    section?: "chats" | "notes" | "tasks" | "folders" | "time";
    client?: string;
    search?: boolean;
  } => ({
    ...(typeof search.client === "string" ? { client: search.client } : {}),
    ...(typeof search.environment === "string" ? { environment: search.environment } : {}),
    ...(["chats", "notes", "tasks", "folders", "time"].includes(String(search.section))
      ? { section: search.section as "chats" | "notes" | "tasks" | "folders" | "time" }
      : {}),
    ...(search.search === true ? { search: true } : {}),
    ...(search.create === true ? { create: true } : {}),
    ...(typeof search.item === "string" ? { item: search.item } : {}),
  }),
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  component: HubRoute,
});

function HubRoute() {
  const search = Route.useSearch();
  return (
    <ProjectHome
      key={`${search.environment ?? ""}:${search.item ?? ""}:${search.create ?? false}:${search.section ?? ""}:${search.client ?? ""}:${search.search ?? false}`}
      environment={search.environment}
      item={search.item}
      create={search.create}
      section={search.section}
      client={search.client}
      focusSearch={search.search}
    />
  );
}
