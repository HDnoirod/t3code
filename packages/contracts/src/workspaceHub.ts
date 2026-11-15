import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import {
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
  ThreadId,
  ProjectId,
} from "./baseSchemas.ts";
import { TimeTrackingDate } from "./timeTracking.ts";
import { ModelSelection } from "./orchestration.ts";

// Internal scratch space for chats outside any project; never a sidebar project.
export const FREE_CHAT_WORKSPACE_ID = ProjectId.make("t3-free-chats");
const CLIENT_CHAT_WORKSPACE_PREFIX = "t3-client-chats:";
// These workspaces are provider scratch space, not user-visible project hubs.
export const clientChatWorkspaceId = (clientId: string) =>
  ProjectId.make(`${CLIENT_CHAT_WORKSPACE_PREFIX}${clientId}`);
export const clientIdForChatWorkspace = (workspaceId: string): string | null =>
  workspaceId.startsWith(CLIENT_CHAT_WORKSPACE_PREFIX) &&
  workspaceId.length > CLIENT_CHAT_WORKSPACE_PREFIX.length
    ? workspaceId.slice(CLIENT_CHAT_WORKSPACE_PREFIX.length)
    : null;
export const isStandaloneChatWorkspace = (workspaceId: string) =>
  workspaceId === FREE_CHAT_WORKSPACE_ID || clientIdForChatWorkspace(workspaceId) !== null;

const Id = TrimmedNonEmptyString.check(Schema.isMaxLength(100));
const Ids = Schema.Array(Id).check(Schema.isMaxLength(100));
export const HubKind = Schema.Literals(["project", "note", "task"]);
export type HubKind = typeof HubKind.Type;
export const HubStatus = Schema.Literals([
  "active",
  "paused",
  "complete",
  "todo",
  "doing",
  "waiting",
  "done",
]);
export const HubPriority = Schema.Literals(["low", "normal", "high"]);
const SummaryFields = {
  id: Id,
  kind: HubKind,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  clientIds: Ids,
  projectIds: Ids,
  workspaceIds: Ids,
  threadIds: Ids,
  // Reference links are separate from chats that receive this project's context.
  excludedChatIds: Schema.optionalKey(Ids),
  chatIds: Ids.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  aiContext: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  relatedIds: Ids,
  tags: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(40))).check(
    Schema.isMaxLength(30),
  ),
  folder: Schema.String.check(Schema.isMaxLength(100)),
  pinned: Schema.Boolean,
  archived: Schema.Boolean,
  status: HubStatus,
  priority: HubPriority,
  dueDate: Schema.NullOr(TimeTrackingDate),
};
const ContentFields = {
  body: Schema.String.check(Schema.isMaxLength(100_000)),
  contacts: Schema.String.check(Schema.isMaxLength(10_000)),
  resources: Schema.Array(
    Schema.Struct({
      label: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
      url: Schema.String.check(Schema.isMaxLength(2000), Schema.isPattern(/^https?:\/\/\S+$/i)),
    }),
  ).check(Schema.isMaxLength(100)),
};
const Timestamps = { createdAt: Schema.String, updatedAt: Schema.String };
export const HubSummary = Schema.Struct({ ...SummaryFields, ...Timestamps, version: PositiveInt });
export type HubSummary = typeof HubSummary.Type;
export const HubItem = Schema.Struct({
  ...SummaryFields,
  ...ContentFields,
  ...Timestamps,
  version: PositiveInt,
});
export type HubItem = typeof HubItem.Type;
export const HubSaveInput = Schema.Struct({
  ...SummaryFields,
  ...ContentFields,
  chatIds: Schema.optionalKey(Ids),
  aiContext: Schema.optionalKey(Schema.Boolean),
  version: NonNegativeInt,
});
export type HubSaveInput = typeof HubSaveInput.Type;
export const HubListInput = Schema.Struct({ search: Schema.String.check(Schema.isMaxLength(200)) });
export type HubListInput = typeof HubListInput.Type;
export const HubList = Schema.Struct({
  items: Schema.Array(HubSummary),
  truncated: Schema.Boolean,
});
export const HubGetInput = Schema.Struct({ id: Id });
export type HubGetInput = typeof HubGetInput.Type;
export const HubMoveProjectInput = Schema.Struct({
  id: Id,
  clientId: Schema.NullOr(Id),
  version: PositiveInt,
});
export type HubMoveProjectInput = typeof HubMoveProjectInput.Type;

export const HubChatDefaultsInput = Schema.Struct({ workspaceId: ProjectId });
export type HubChatDefaultsInput = typeof HubChatDefaultsInput.Type;
export const HubChatDefaults = Schema.Struct({
  modelSelection: Schema.NullOr(ModelSelection),
  unavailableReason: Schema.NullOr(Schema.String),
});
export type HubChatDefaults = typeof HubChatDefaults.Type;

export const HubEnsureProjectInput = Schema.Struct({ workspaceId: ProjectId });
export type HubEnsureProjectInput = typeof HubEnsureProjectInput.Type;
export const HubCreateChatInput = Schema.Struct({
  projectId: Schema.NullOr(Id),
  clientId: Schema.optionalKey(Id),
  threadId: ThreadId,
  workspaceId: Schema.optionalKey(ProjectId),
}).check(
  Schema.makeFilter((input) => !input.clientId || (input.projectId === null && !input.workspaceId)),
);
export type HubCreateChatInput = typeof HubCreateChatInput.Type;
export const HubCreateChatResult = Schema.Struct({ threadId: ThreadId, workspaceId: ProjectId });
export const HubChatContextInput = Schema.Struct({ threadId: ThreadId });
export type HubChatContextInput = typeof HubChatContextInput.Type;
export const HubContextFolder = Schema.Struct({
  id: ProjectId,
  title: Schema.String,
  path: Schema.String,
});
export type HubContextFolder = typeof HubContextFolder.Type;
export const HubChatContext = Schema.Struct({
  client: Schema.optionalKey(Schema.Struct({ id: Id, name: Schema.String })),
  folders: Schema.optionalKey(Schema.Array(HubContextFolder)),
  projects: Schema.Array(Schema.Struct({ id: Id, title: Schema.String })),
  sources: Schema.Array(
    Schema.Struct({ id: Id, title: Schema.String, kind: HubKind, version: PositiveInt }),
  ),
  text: Schema.String,
  truncated: Schema.Boolean,
});
export type HubChatContext = typeof HubChatContext.Type;
export const HubExport = Schema.Struct({
  format: Schema.Literal("t3-workspace-v1"),
  exportedAt: Schema.String,
  items: Schema.Array(HubItem),
});
export class HubError extends Schema.TaggedError<HubError>()("HubError", {
  message: Schema.String,
}) {}
