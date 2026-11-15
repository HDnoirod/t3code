import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../connection/runtime";

export const timeTrackingQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "time-tracking:list",
  tag: WS_METHODS.timeTrackingList,
  staleTimeMs: 0,
  refreshIntervalMs: 30_000,
});
export const timeTrackingMutation = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "time-tracking:mutate",
  tag: WS_METHODS.timeTrackingMutate,
});

export const timeTrackingReportQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "time-tracking:report",
  tag: WS_METHODS.timeTrackingReport,
  staleTimeMs: 0,
  refreshIntervalMs: 30_000,
});
