// @effect-diagnostics nodeBuiltinImport:off - Stable hashes preserve existing private workspace paths.
import * as NodeCrypto from "node:crypto";
import {
  CommandId,
  FREE_CHAT_WORKSPACE_ID,
  clientChatWorkspaceId,
  isStandaloneChatWorkspace,
  DEFAULT_MODEL_BY_PROVIDER,
  HubCreateChatInput,
  HubError,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerConfig } from "../config.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { makeWorkspaceHubStore } from "./WorkspaceHub.ts";
const DEFAULT_THREAD_TITLE = "New thread";
import { makeHubChatDefaults } from "./HubChatDefaults.ts";

const decodeCreate = Schema.decodeUnknownEffect(HubCreateChatInput);
const isHubError = Schema.is(HubError);

export const makeWorkspaceHubChats = Effect.gen(function* () {
  const hub = yield* makeWorkspaceHubStore;
  const engine = yield* ThreadManagementService;
  const projects = yield* ProjectService;
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settings = yield* ServerSettingsService;
  const registry = yield* ProviderRegistry;
  const chatDefaults = yield* makeHubChatDefaults;
  const sql = yield* SqlClient.SqlClient;
  return Effect.fn("WorkspaceHub.createChat")(
    function* (
      input: HubCreateChatInput,
      dispatch: ThreadManagementService["Service"]["dispatch"] = engine.dispatch,
    ) {
      const request = yield* decodeCreate(input);
      const project = request.projectId === null ? null : yield* hub.get({ id: request.projectId });
      const clientRows = request.clientId
        ? yield* sql<{
            name: string;
            archived: number;
          }>`SELECT name, archived FROM time_tracking_clients WHERE id = ${request.clientId}`
        : [];
      const client = clientRows[0];
      if (request.clientId && !client)
        return yield* new HubError({ message: "This client no longer exists." });
      const standaloneWorkspaceId = request.clientId
        ? clientChatWorkspaceId(request.clientId)
        : FREE_CHAT_WORKSPACE_ID;
      if (!project && request.workspaceId)
        return yield* new HubError({ message: "Free chats use their own working space." });
      if (project && (project.kind !== "project" || project.archived))
        return yield* new HubError({ message: "Choose an active project hub." });
      if (project && request.workspaceId && isStandaloneChatWorkspace(request.workspaceId))
        return yield* new HubError({
          message: "Choose a project folder instead of a chat's private working space.",
        });
      const existing = yield* engine.getThreadShell(request.threadId);
      if (existing !== null) {
        // Retry the same creation after a lost response without creating another chat.
        if (!project && existing.projectId !== standaloneWorkspaceId)
          return yield* new HubError({ message: "This chat identifier is already in use." });
        if (project) yield* hub.attachChat(project.id, request.threadId);
        return { threadId: request.threadId, workspaceId: existing.projectId };
      }
      if (client?.archived)
        return yield* new HubError({ message: "Restore this client before starting a new chat." });
      if (project && project.chatIds.length >= 100)
        return yield* new HubError({
          message: "This hub has 100 chats. Unlink older chats before adding another.",
        });
      const defaults = yield* chatDefaults(
        request.clientId ? { clientId: request.clientId } : { projectId: project?.id ?? null },
      );
      if (defaults.unavailableReason)
        return yield* new HubError({ message: defaults.unavailableReason });
      const suffix = request.clientId
        ? `client-${NodeCrypto.createHash("sha256").update(request.clientId).digest("hex").slice(0, 24)}`
        : project
          ? NodeCrypto.createHash("sha256").update(project.id).digest("hex").slice(0, 24)
          : "free-chats";
      // Older projects linked chats before they had a default working folder.
      // Reuse that chat's folder rather than opening an unrelated empty directory.
      let inheritedWorkspaceId: ProjectId | undefined;
      if (project && !request.workspaceId && !project.workspaceIds.length) {
        for (const chatId of project.chatIds) {
          const chat = yield* engine.getThreadShell(ThreadId.make(chatId));
          if (chat !== null) {
            const folder = yield* projects.getShell(chat.projectId);
            if (Option.isSome(folder) && !isStandaloneChatWorkspace(folder.value.id)) {
              inheritedWorkspaceId = folder.value.id;
              break;
            }
          }
        }
      }
      const workspaceId =
        request.workspaceId ??
        (project?.workspaceIds[0]
          ? ProjectId.make(project.workspaceIds[0])
          : inheritedWorkspaceId) ??
        (project ? ProjectId.make(`hub-${suffix}`) : standaloneWorkspaceId);
      let workspace = yield* projects.getShell(workspaceId);
      if (Option.isNone(workspace)) {
        if (request.workspaceId || project?.workspaceIds.length)
          return yield* new HubError({
            message:
              "The linked workspace is unavailable. Choose another folder or remove the link.",
          });
        const root = path.join(config.stateDir, "hub-workspaces", suffix);
        yield* fs.makeDirectory(root, { recursive: true });
        yield* projects.create({
          commandId: CommandId.make(`hub-workspace-${suffix}`),
          projectId: workspaceId,
          title: project?.title ?? (client ? `${client.name} chats` : "Free chats"),
          workspaceRoot: root,
        });
        workspace = yield* projects.getShell(workspaceId);
      }
      const resolved = resolveProjectSettings(
        yield* settings.getSettings,
        workspaceId,
        Option.getOrUndefined(workspace),
      ).settings;
      const providers = yield* registry.getProviders;
      const provider =
        providers.find(
          (value) => value.enabled && value.installed && value.availability !== "unavailable",
        ) ?? providers.find((value) => value.enabled && value.availability !== "unavailable");
      const model =
        provider?.models.find((value) => value.isDefault)?.slug ??
        provider?.models[0]?.slug ??
        (provider ? DEFAULT_MODEL_BY_PROVIDER[provider.driver] : undefined);
      const modelSelection =
        defaults.modelSelection ??
        resolved.defaultModelSelection ??
        (provider && model ? { instanceId: provider.instanceId, model } : null);
      if (!modelSelection)
        return yield* new HubError({
          message: "Enable a provider in Settings before starting a chat.",
        });
      yield* dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make(`hub-chat-${request.threadId}`),
        threadId: request.threadId,
        projectId: workspaceId,
        title: DEFAULT_THREAD_TITLE,
        modelSelection,
        runtimeMode: resolved.defaultRuntimeMode,
        interactionMode: "default",
        branch: null,
        worktreePath: null,
      });
      if (project) yield* hub.attachChat(project.id, request.threadId);
      return { threadId: request.threadId, workspaceId };
    },
    Effect.mapError((cause) =>
      isHubError(cause)
        ? cause
        : new HubError({
            message: "Could not create the project chat. Check the connection and try again.",
          }),
    ),
  );
});
