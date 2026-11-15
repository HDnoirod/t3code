import * as NodeCrypto from "node:crypto";
import {
  HubError,
  isStandaloneChatWorkspace,
  clientIdForChatWorkspace,
  HubEnsureProjectInput,
  HubMoveProjectInput,
  ProjectId,
  HubGetInput,
  HubItem,
  HubListInput,
  HubSaveInput,
  HubSummary,
  HubChatContextInput,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { buildHubChatContext } from "./workspaceHubContext.ts";

const decodeItem = Schema.decodeUnknownEffect(Schema.fromJsonString(HubItem));
const decodeSummary = Schema.decodeUnknownEffect(Schema.fromJsonString(HubSummary));
const encodeItem = Schema.encodeEffect(Schema.fromJsonString(HubItem));
const encodeClientIds = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.String)));
const decodeGet = Schema.decodeUnknownEffect(HubGetInput);
const decodeList = Schema.decodeUnknownEffect(HubListInput);
const decodeChatContext = Schema.decodeUnknownEffect(HubChatContextInput);
const decodeMoveProject = Schema.decodeUnknownEffect(HubMoveProjectInput);
const decodeEnsureProject = Schema.decodeUnknownEffect(HubEnsureProjectInput);
const decodeSave = Schema.decodeUnknownEffect(HubSaveInput);
const isHubError = Schema.is(HubError);
const searchText = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
const recover = (cause: unknown) =>
  isHubError(cause)
    ? cause
    : new HubError({
        message: "Could not load or save workspace data. Check your connection and try again.",
      });

export const makeWorkspaceHubStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const get = Effect.fn("WorkspaceHub.get")(function* (input: HubGetInput) {
    const { id } = yield* decodeGet(input);
    const rows = yield* sql<{ data: string }>`SELECT data FROM workspace_hub WHERE id = ${id}`;
    if (!rows[0]) return yield* new HubError({ message: "This item no longer exists." });
    return yield* decodeItem(rows[0].data);
  }, Effect.mapError(recover));

  const list = Effect.fn("WorkspaceHub.list")(function* (input: HubListInput) {
    const { search } = yield* decodeList(input);
    const term = searchText(search.trim());
    // List views only carry metadata. Large note bodies are loaded on selection.
    const rows = yield* sql<{
      data: string;
    }>`SELECT json_remove(data, '$.body', '$.contacts', '$.resources') AS data
      FROM workspace_hub WHERE ${term} = '' OR
      instr(search_text, ${term}) > 0
      ORDER BY json_extract(data, '$.updatedAt') DESC, id LIMIT 2001`;
    return {
      items: yield* Effect.forEach(rows.slice(0, 2000), (row) => decodeSummary(row.data)),
      truncated: rows.length > 2000,
    };
  }, Effect.mapError(recover));

  const save = Effect.fn("WorkspaceHub.save")(function* (input: HubSaveInput) {
    const change = yield* decodeSave(input);
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const previous = yield* sql<{
          data: string;
          version: number;
          kind: string;
        }>`SELECT data, version, kind FROM workspace_hub WHERE id = ${change.id}`;
        const oldItem = previous[0] ? yield* decodeItem(previous[0].data) : null;
        const chatIds = change.chatIds ?? oldItem?.chatIds ?? [];
        if (change.kind !== "project" && chatIds.length)
          return yield* new HubError({ message: "Only project hubs can contain chats." });
        if (
          (previous[0]?.version ?? 0) !== change.version ||
          (previous[0] && previous[0].kind !== change.kind)
        )
          return yield* new HubError({
            message:
              "This item changed on another device. Your draft is still here; reload the saved version before editing again.",
          });
        const statuses =
          change.kind === "task"
            ? ["todo", "doing", "waiting", "done"]
            : ["active", "paused", "complete"];
        if (!statuses.includes(change.status))
          return yield* new HubError({ message: "Choose a valid status for this item." });
        for (const [ids, kind] of [
          [change.projectIds, "project"],
          [change.relatedIds, null],
        ] as const) {
          if (ids.includes(change.id))
            return yield* new HubError({ message: "An item cannot link to itself." });
          for (const id of new Set(ids)) {
            const matches = yield* sql<{
              kind: string;
            }>`SELECT kind FROM workspace_hub WHERE id = ${id}`;
            if (!matches[0] || (kind && matches[0].kind !== kind))
              return yield* new HubError({
                message: "A linked item is unavailable. Review the links before saving.",
              });
          }
        }
        for (const id of new Set(change.clientIds)) {
          const matches = yield* sql`SELECT id FROM time_tracking_clients WHERE id = ${id}`;
          if (!matches.length)
            return yield* new HubError({ message: "Choose an existing client." });
        }
        // Keep saved links when their targets disappear; only newly added links
        // need a live target. Unrelated edits must not discard or depend on them.
        for (const id of new Set(change.workspaceIds)) {
          if (isStandaloneChatWorkspace(id))
            return yield* new HubError({
              message: "Client and free chats cannot be used as a project folder.",
            });
          if (oldItem?.workspaceIds.includes(id)) continue;
          const matches =
            yield* sql`SELECT project_id FROM projection_projects WHERE project_id = ${id} AND deleted_at IS NULL`;
          if (!matches.length)
            return yield* new HubError({ message: "A linked workspace folder is unavailable." });
        }
        const addedChatIds = new Set([
          ...change.threadIds.filter((id) => !oldItem?.threadIds.includes(id)),
          ...chatIds.filter((id) => !oldItem?.chatIds.includes(id)),
        ]);
        for (const id of addedChatIds) {
          const matches =
            yield* sql`SELECT thread_id FROM projection_threads WHERE thread_id = ${id} AND deleted_at IS NULL`;
          if (!matches.length)
            return yield* new HubError({ message: "A linked chat is unavailable." });
        }
        const timestamp = DateTime.formatIso(yield* DateTime.now);
        const item: HubItem = {
          ...change,
          chatIds: [...new Set(chatIds)],
          excludedChatIds: change.excludedChatIds ?? oldItem?.excludedChatIds ?? [],
          aiContext: change.aiContext ?? oldItem?.aiContext ?? false,
          clientIds: [...new Set(change.clientIds)],
          projectIds: [...new Set(change.projectIds)],
          workspaceIds: [...new Set(change.workspaceIds)],
          threadIds: [...new Set(change.threadIds)],
          relatedIds: [...new Set(change.relatedIds)],
          tags: [...new Set(change.tags)],
          version: change.version + 1,
          createdAt: oldItem?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        const data = yield* encodeItem(item);
        const searchable = searchText(
          [item.title, item.body, item.contacts, item.folder, ...item.tags].join(" "),
        );
        if (change.version === 0)
          yield* sql`INSERT INTO workspace_hub (id, kind, version, data, search_text) VALUES (${item.id}, ${item.kind}, ${item.version}, ${data}, ${searchable})`;
        else
          yield* sql`UPDATE workspace_hub SET data = ${data}, version = ${item.version}, search_text = ${searchable} WHERE id = ${item.id} AND version = ${change.version}`;
        return item;
      }),
    );
  }, Effect.mapError(recover));

  const moveProject = Effect.fn("WorkspaceHub.moveProject")(function* (input: HubMoveProjectInput) {
    const change = yield* decodeMoveProject(input);
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const project = yield* get({ id: change.id });
        if (project.kind !== "project" || project.archived)
          return yield* new HubError({ message: "Choose an active project to move." });
        if (project.version !== change.version)
          return yield* new HubError({
            message: "This project changed on another device. Try moving it again.",
          });
        if (change.clientId !== null) {
          const clients =
            yield* sql`SELECT id FROM time_tracking_clients WHERE id = ${change.clientId} AND archived = 0`;
          if (!clients.length) return yield* new HubError({ message: "Choose an active client." });
        }
        const clientIds = change.clientId === null ? [] : [change.clientId];
        if (
          project.clientIds.length === clientIds.length &&
          project.clientIds.every((id, i) => id === clientIds[i])
        ) {
          const { body: _, contacts: __, resources: ___, ...summary } = project;
          return summary;
        }
        const updatedAt = DateTime.formatIso(yield* DateTime.now);
        const encodedClientIds = yield* encodeClientIds(clientIds);
        // Moving the container must not rewrite its notes, chat links or working folders.
        yield* sql`UPDATE workspace_hub SET data = json_set(data, '$.clientIds', json(${encodedClientIds}), '$.version', ${project.version + 1}, '$.updatedAt', ${updatedAt}), version = version + 1 WHERE id = ${project.id} AND version = ${project.version}`;
        const { body: _, contacts: __, resources: ___, ...summary } = project;
        return { ...summary, clientIds, version: project.version + 1, updatedAt };
      }),
    );
  }, Effect.mapError(recover));

  const exportData = Effect.fn("WorkspaceHub.export")(function* () {
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const sizes = yield* sql<{
          bytes: number;
        }>`SELECT COALESCE(SUM(length(CAST(data AS BLOB))), 0) AS bytes FROM workspace_hub`;
        if ((sizes[0]?.bytes ?? 0) > 20_000_000)
          return yield* new HubError({
            message:
              "Workspace export exceeds 20 MB. Export individual notes or back up the T3 data directory.",
          });
        const rows = yield* sql<{ data: string }>`SELECT data FROM workspace_hub ORDER BY id`;
        return {
          format: "t3-workspace-v1" as const,
          exportedAt: DateTime.formatIso(yield* DateTime.now),
          items: yield* Effect.forEach(rows, (row) => decodeItem(row.data)),
        };
      }),
    );
  }, Effect.mapError(recover));
  const chatContext = Effect.fn("WorkspaceHub.chatContext")(function* (input: HubChatContextInput) {
    const { threadId } = yield* decodeChatContext(input);
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const rows = yield* sql<{ data: string }>`SELECT data FROM workspace_hub
        WHERE kind = 'project' AND json_extract(data, '$.archived') = 0
        AND EXISTS (SELECT 1 FROM json_each(data, '$.chatIds') WHERE value = ${threadId}) ORDER BY id`;
        let projects = yield* Effect.forEach(rows, (row) => decodeItem(row.data));
        const thread = yield* sql<{
          project_id: string;
        }>`SELECT project_id FROM projection_threads WHERE thread_id = ${threadId} AND deleted_at IS NULL`;
        const clientId = thread[0] ? clientIdForChatWorkspace(thread[0].project_id) : null;
        if (!projects.length && thread[0] && !isStandaloneChatWorkspace(thread[0].project_id)) {
          const inherited = yield* sql<{ data: string }>`SELECT h.data FROM workspace_hub h
            WHERE h.kind = 'project' AND json_extract(h.data, '$.archived') = 0
            AND NOT EXISTS (SELECT 1 FROM json_each(h.data, '$.excludedChatIds') WHERE value = ${threadId})
            AND (EXISTS (SELECT 1 FROM json_each(h.data, '$.workspaceIds') WHERE value = ${thread[0].project_id})
              OR EXISTS (SELECT 1 FROM json_each(h.data, '$.chatIds') c JOIN projection_threads t ON t.thread_id = c.value WHERE t.project_id = ${thread[0].project_id} AND t.deleted_at IS NULL))
            ORDER BY json_extract(h.data, '$.createdAt'), h.id LIMIT 1`;
          projects = yield* Effect.forEach(inherited, (row) => decodeItem(row.data));
        }
        const folderIds = new Set(projects.flatMap((project) => project.workspaceIds));
        if (thread[0]) folderIds.add(thread[0].project_id);
        for (const project of projects) {
          if (!project.chatIds.length) continue;
          const linked = yield* sql<{
            project_id: string;
          }>`SELECT DISTINCT project_id FROM projection_threads WHERE ${sql.in("thread_id", project.chatIds)} AND deleted_at IS NULL`;
          for (const row of linked) folderIds.add(row.project_id);
        }
        for (const id of folderIds) if (isStandaloneChatWorkspace(id)) folderIds.delete(id);
        const folderRows = folderIds.size
          ? yield* sql<{
              project_id: string;
              title: string;
              workspace_root: string;
            }>`SELECT project_id, title, workspace_root FROM projection_projects WHERE ${sql.in("project_id", [...folderIds])} AND deleted_at IS NULL ORDER BY project_id`
          : [];
        const folders = folderRows.map((folder) => ({
          id: ProjectId.make(folder.project_id),
          title: folder.title,
          path: folder.workspace_root,
        }));
        const clientRows = clientId
          ? yield* sql<{
              id: string;
              name: string;
            }>`SELECT id, name FROM time_tracking_clients WHERE id = ${clientId}`
          : [];
        const client = clientRows[0];
        const overview = client
          ? yield* sql<{
              title: string;
              status: string;
              body: string;
            }>`SELECT json_extract(data, '$.title') AS title,
            json_extract(data, '$.status') AS status, substr(json_extract(data, '$.body'), 1, 601) AS body FROM workspace_hub
          WHERE kind = 'project' AND json_extract(data, '$.archived') = 0
          AND json_extract(data, '$.clientIds[0]') = ${client.id}
          ORDER BY json_extract(data, '$.title'), id LIMIT 101`
          : [];
        if (!projects.length && !client) return buildHubChatContext([], [], folders);
        const notes = yield* sql<{ data: string }>`SELECT data FROM workspace_hub
        WHERE kind = 'note' AND json_extract(data, '$.aiContext') = 1
        AND json_extract(data, '$.archived') = 0
        AND (EXISTS (SELECT 1 FROM json_each(data, '$.projectIds') WHERE ${sql.in(
          "value",
          projects.map((project) => project.id),
        )}) OR (${client?.id ?? null} IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(data, '$.clientIds') WHERE value = ${client?.id ?? null})))
        ORDER BY json_extract(data, '$.pinned') DESC, id LIMIT 101`;
        return buildHubChatContext(
          projects,
          yield* Effect.forEach(notes, (row) => decodeItem(row.data)),
          folders,
          client ? { ...client, projects: overview } : undefined,
        );
      }),
    );
  }, Effect.mapError(recover));
  const attachChat = Effect.fn("WorkspaceHub.attachChat")(function* (
    projectId: string,
    threadId: string,
  ) {
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const project = yield* get({ id: projectId });
        if (project.kind !== "project" || project.archived)
          return yield* new HubError({ message: "Choose an active project hub." });
        if (project.chatIds.includes(threadId)) return project;
        return yield* save({
          ...project,
          pinned: true,
          chatIds: [...project.chatIds, threadId],
          excludedChatIds: (project.excludedChatIds ?? []).filter((id) => id !== threadId),
        });
      }),
    );
  }, Effect.mapError(recover));
  const ensureProject = Effect.fn("WorkspaceHub.ensureProject")(function* (
    input: HubEnsureProjectInput,
  ) {
    const { workspaceId } = yield* decodeEnsureProject(input);
    if (isStandaloneChatWorkspace(workspaceId))
      return yield* new HubError({ message: "Client and free chats do not belong to a project." });
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const folders = yield* sql<{
          title: string;
        }>`SELECT title FROM projection_projects WHERE project_id = ${workspaceId} AND deleted_at IS NULL`;
        if (!folders[0])
          return yield* new HubError({ message: "This folder is no longer available." });
        const existing = yield* sql<{
          data: string;
        }>`SELECT h.data FROM workspace_hub h WHERE h.kind = 'project' AND json_extract(h.data, '$.archived') = 0 AND (
        EXISTS (SELECT 1 FROM json_each(h.data, '$.workspaceIds') WHERE value = ${workspaceId}) OR
        EXISTS (SELECT 1 FROM json_each(h.data, '$.chatIds') c JOIN projection_threads t ON t.thread_id = c.value WHERE t.project_id = ${workspaceId} AND t.deleted_at IS NULL))
        ORDER BY json_extract(h.data, '$.createdAt'), h.id LIMIT 1`;
        if (existing[0]) return yield* decodeItem(existing[0].data);
        const id = `folder-${NodeCrypto.createHash("sha256").update(workspaceId).digest("hex").slice(0, 24)}`;
        const previous = yield* sql<{
          data: string;
        }>`SELECT data FROM workspace_hub WHERE id = ${id}`;
        if (previous[0]) {
          const archived = yield* decodeItem(previous[0].data);
          return yield* save({ ...archived, archived: false });
        }
        return yield* save({
          id,
          kind: "project",
          title: folders[0].title.slice(0, 200),
          body: "",
          contacts: "",
          resources: [],
          clientIds: [],
          projectIds: [],
          workspaceIds: [workspaceId],
          threadIds: [],
          chatIds: [],
          relatedIds: [],
          tags: [],
          folder: "",
          pinned: false,
          archived: false,
          status: "active",
          priority: "normal",
          dueDate: null,
          version: 0,
        });
      }),
    );
  }, Effect.mapError(recover));
  return { get, list, save, moveProject, exportData, chatContext, attachChat, ensureProject };
});
