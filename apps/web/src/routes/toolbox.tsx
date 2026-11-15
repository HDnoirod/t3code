import { createFileRoute, redirect } from "@tanstack/react-router";
import { ToolboxPage } from "../components/toolbox/ToolboxPage";

export const Route = createFileRoute("/toolbox")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  component: () => <ToolboxPage />,
});
