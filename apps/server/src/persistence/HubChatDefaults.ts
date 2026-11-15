import {
  isStandaloneChatWorkspace,
  clientIdForChatWorkspace,
  ModelSelection,
  HubError,
  type ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { isModelSelectionProviderEnabled } from "@t3tools/shared/serverSettings";

const decodeModel = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.NullOr(ModelSelection)),
);

export const makeHubChatDefaults = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* ServerSettingsService;
  const registry = yield* ProviderRegistry;
  return Effect.fn("HubChatDefaults.resolve")(
    function* (
      input: { projectId: string | null } | { workspaceId: ProjectId } | { clientId: string },
    ) {
      let projectId: string | null = "projectId" in input ? input.projectId : null;
      const clientId =
        "clientId" in input
          ? input.clientId
          : "workspaceId" in input
            ? clientIdForChatWorkspace(input.workspaceId)
            : null;
      if ("workspaceId" in input && !isStandaloneChatWorkspace(input.workspaceId)) {
        // Use the same stable folder ownership as the sidebar and project promotion.
        const projects = yield* sql<{ id: string }>`SELECT h.id FROM workspace_hub h
        WHERE h.kind = 'project' AND json_extract(h.data, '$.archived') = 0 AND (
          EXISTS (SELECT 1 FROM json_each(h.data, '$.workspaceIds') WHERE value = ${input.workspaceId}) OR
          EXISTS (SELECT 1 FROM json_each(h.data, '$.chatIds') c JOIN orchestration_v2_projection_threads t ON t.thread_id = c.value
            WHERE t.project_id = ${input.workspaceId} AND t.deleted_at IS NULL))
        ORDER BY json_extract(h.data, '$.createdAt'), h.id LIMIT 1`;
        projectId = projects[0]?.id ?? null;
      }
      const clients =
        clientId !== null
          ? yield* sql<{
              name: string;
              model: string | null;
            }>`SELECT name, default_model_selection_json AS model FROM time_tracking_clients WHERE id = ${clientId}`
          : projectId === null
            ? []
            : yield* sql<{ name: string; model: string | null }>`
      SELECT c.name, c.default_model_selection_json AS model
      FROM workspace_hub h JOIN time_tracking_clients c ON c.id = json_extract(h.data, '$.clientIds[0]')
      WHERE h.id = ${projectId} AND h.kind = 'project' AND json_extract(h.data, '$.archived') = 0`;
      const clientModel = yield* decodeModel(clients[0]?.model ?? "null");
      const currentSettings = yield* settings.getSettings;
      const modelSelection = clientModel ?? currentSettings.defaultModelSelection;
      if (!modelSelection) return { modelSelection: null, unavailableReason: null };
      const provider = (yield* registry.getProviders).find(
        (provider) => provider.instanceId === modelSelection.instanceId,
      );
      const available =
        isModelSelectionProviderEnabled(currentSettings, modelSelection) &&
        provider?.enabled &&
        provider.installed &&
        provider.auth.status !== "unauthenticated" &&
        provider.availability !== "unavailable";
      return {
        modelSelection,
        unavailableReason: available
          ? null
          : `The default AI account for ${clientModel ? clients[0]!.name : "other chats"} (${provider?.displayName ?? modelSelection.instanceId}) is unavailable. Choose another account in Clients or enable it in Settings → Providers.`,
      };
    },
    Effect.mapError(
      () => new HubError({ message: "Could not load the default AI account. Try again." }),
    ),
  );
});
