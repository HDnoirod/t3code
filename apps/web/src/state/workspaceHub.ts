import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../connection/runtime";

export const hubListQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "hub:list",
  tag: WS_METHODS.hubList,
  staleTimeMs: 0,
  refreshIntervalMs: 30_000,
});
export const hubItemQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "hub:item",
  tag: WS_METHODS.hubGet,
  staleTimeMs: 0,
});
export const hubSaveCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "hub:save",
  tag: WS_METHODS.hubSave,
});
export const hubGetCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "hub:get",
  tag: WS_METHODS.hubGet,
});
export const hubExportCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "hub:export",
  tag: WS_METHODS.hubExport,
});
export const hubCreateChatCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "hub:create-chat",
  tag: WS_METHODS.hubCreateChat,
});
export const hubChatContextQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "hub:chat-context",
  tag: WS_METHODS.hubChatContext,
  staleTimeMs: 0,
});

export const hubEnsureProjectCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "hub:ensure-project",
  tag: WS_METHODS.hubEnsureProject,
});

export const hubMoveProjectCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "hub:move-project",
  tag: WS_METHODS.hubMoveProject,
});

export const hubChatDefaultsQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "hub:chat-defaults",
  tag: WS_METHODS.hubChatDefaults,
  staleTimeMs: 0,
});
