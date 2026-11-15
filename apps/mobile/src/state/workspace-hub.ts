import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../connection/runtime";

export const hubChatDefaultsQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "hub:chat-defaults",
  tag: WS_METHODS.hubChatDefaults,
  staleTimeMs: 0,
});
