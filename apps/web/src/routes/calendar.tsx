import { createFileRoute, redirect } from "@tanstack/react-router";
import { TimeTrackingPage } from "../components/timeTracking/TimeTrackingPage";

export const Route = createFileRoute("/calendar")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: TimeTrackingPage,
});
