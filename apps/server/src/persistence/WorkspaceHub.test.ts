import { assert, it } from "@effect/vitest";
import { ThreadId, ProjectId, type HubSaveInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "./Layers/Sqlite.ts";
import { makeWorkspaceHubStore } from "./WorkspaceHub.ts";
import { makeTimeTrackingStore } from "./TimeTracking.ts";

function record(
  id: string,
  kind: HubSaveInput["kind"] = "note",
  extra: Partial<HubSaveInput> = {},
): HubSaveInput {
  return {
    id,
    kind,
    title: id,
    body: "Shared briefing",
    contacts: "",
    resources: [],
    clientIds: [],
    projectIds: [],
    workspaceIds: [],
    threadIds: [],
    relatedIds: [],
    tags: [],
    folder: "",
    pinned: false,
    archived: false,
    status: kind === "task" ? "todo" : "active",
    priority: "normal",
    dueDate: null,
    version: 0,
    ...extra,
  };
}

const seedChat = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, created_at, updated_at)
    VALUES ('chat', 'folder', 'Test chat', '2026-11-03', '2026-11-03')`;
});

it.effect("hub chats receive only their briefs and explicitly selected shared notes", () =>
  Effect.gen(function* () {
    yield* seedChat;
    const hub = yield* makeWorkspaceHubStore;
    const alpha = yield* hub.save(
      record("alpha", "project", { chatIds: ["chat"], body: "Alpha brief" }),
    );
    yield* hub.save(record("beta", "project", { chatIds: ["chat"], body: "Beta brief" }));
    yield* hub.save(record("unrelated", "project", { body: "Unrelated brief" }));
    const shared = yield* hub.save(
      record("shared", "note", {
        projectIds: ["alpha", "beta"],
        aiContext: true,
        body: "Shared context",
      }),
    );
    yield* hub.save(record("private", "note", { projectIds: ["alpha"], body: "PRIVATE" }));
    yield* hub.save(
      record("archived", "note", {
        projectIds: ["alpha"],
        aiContext: true,
        archived: true,
        body: "ARCHIVED",
      }),
    );
    yield* hub.save(
      record("unrelated-note", "note", {
        projectIds: ["unrelated"],
        aiContext: true,
        body: "OTHER CLIENT",
      }),
    );
    const context = yield* hub.chatContext({ threadId: ThreadId.make("chat") });
    assert.deepEqual(
      context.sources.map((source) => source.id),
      ["alpha", "beta", "shared"],
    );
    assert.equal(context.text.includes("PRIVATE"), false);
    assert.equal(context.text.includes("ARCHIVED"), false);
    assert.equal(context.text.includes("OTHER CLIENT"), false);
    const edited = yield* hub.save({ ...shared, body: "Updated shared context" });
    assert.ok(
      (yield* hub.chatContext({ threadId: ThreadId.make("chat") })).text.includes(
        "Updated shared context",
      ),
    );
    yield* hub.save({ ...edited, aiContext: false });
    assert.equal((yield* hub.chatContext({ threadId: ThreadId.make("chat") })).sources.length, 2);
    yield* hub.save({ ...alpha, chatIds: [], threadIds: ["chat"] });
    assert.deepEqual(
      (yield* hub.chatContext({ threadId: ThreadId.make("chat") })).projects.map(
        (project) => project.id,
      ),
      ["beta"],
    );
    const beta = yield* hub.get({ id: "beta" });
    yield* hub.save({ ...beta, archived: true });
    assert.equal((yield* hub.chatContext({ threadId: ThreadId.make("chat") })).text, "");
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect(
  "context is bounded and older clients cannot silently remove chat membership or AI selection",
  () =>
    Effect.gen(function* () {
      yield* seedChat;
      const hub = yield* makeWorkspaceHubStore;
      const project = yield* hub.save(record("project", "project"));
      const attached = yield* hub.attachChat(project.id, "chat");
      assert.equal((yield* hub.attachChat(project.id, "chat")).version, attached.version);
      const { chatIds: _, aiContext: __, ...legacy } = attached;
      const saved = yield* hub.save({ ...legacy, title: "Legacy edit" });
      assert.deepEqual(saved.chatIds, ["chat"]);
      for (let index = 0; index < 6; index++)
        yield* hub.save(
          record(`note-${index}`, "note", {
            projectIds: [project.id],
            aiContext: true,
            body: "a".repeat(100_000),
          }),
        );
      const context = yield* hub.chatContext({ threadId: ThreadId.make("chat") });
      assert.equal(context.truncated, true);
      assert.ok(context.text.length < 41_000);
      assert.ok(context.text.includes("Content shortened"));
      const note = yield* hub.get({ id: "note-0" });
      const { chatIds: ___, aiContext: ____, ...oldNote } = note;
      assert.equal((yield* hub.save(oldNote)).aiContext, true);
      assert.equal(
        (yield* Effect.result(hub.save(record("bad", "project", { chatIds: ["missing"] }))))._tag,
        "Failure",
      );
      assert.equal(
        (yield* Effect.result(hub.save(record("bad", "note", { chatIds: ["chat"] }))))._tag,
        "Failure",
      );
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("one note links to multiple projects and edits propagate without copies", () =>
  Effect.gen(function* () {
    const store = yield* makeWorkspaceHubStore;
    yield* store.save(record("alpha", "project"));
    yield* store.save(record("beta", "project"));
    const note = yield* store.save(
      record("brief", "note", { projectIds: ["alpha", "beta", "alpha"] }),
    );
    assert.deepEqual(note.projectIds, ["alpha", "beta"]);
    yield* store.save({ ...note, body: "Revised scope" });
    const reopened = yield* makeWorkspaceHubStore;
    assert.equal((yield* reopened.get({ id: "brief" })).body, "Revised scope");
    assert.equal((yield* reopened.list({ search: "" })).items.length, 3);
    assert.equal((yield* reopened.list({ search: "revised" })).items[0]?.id, "brief");
    assert.equal("body" in (yield* reopened.list({ search: "revised" })).items[0]!, false);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("rejects stale writes and retains current data", () =>
  Effect.gen(function* () {
    const store = yield* makeWorkspaceHubStore;
    const first = yield* store.save(record("brief"));
    const current = yield* store.save({ ...first, body: "Newer change" });
    assert.equal(
      (yield* Effect.result(store.save({ ...first, body: "Stale change" })))._tag,
      "Failure",
    );
    assert.equal((yield* store.get({ id: "brief" })).body, "Newer change");
    assert.equal(current.version, 2);
    assert.equal(current.createdAt, first.createdAt);
    assert.equal((yield* Effect.result(store.save(record("brief"))))._tag, "Failure");
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("archives, restores, unlinks and reopens tasks without deleting shared information", () =>
  Effect.gen(function* () {
    const store = yield* makeWorkspaceHubStore;
    const project = yield* store.save(record("alpha", "project"));
    const note = yield* store.save(record("brief", "note", { projectIds: [project.id] }));
    const task = yield* store.save(
      record("next", "task", {
        projectIds: [project.id],
        relatedIds: [note.id],
        dueDate: "2026-11-05",
      }),
    );
    const archived = yield* store.save({ ...project, archived: true });
    assert.deepEqual((yield* store.get({ id: note.id })).projectIds, [project.id]);
    yield* store.save({ ...archived, archived: false });
    const done = yield* store.save({ ...task, status: "done" });
    yield* store.save({ ...done, status: "todo", projectIds: [] });
    assert.deepEqual((yield* store.get({ id: task.id })).relatedIds, [note.id]);
    assert.equal((yield* store.list({ search: "" })).items.length, 3);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("validates links, kinds, date boundaries and unsafe resource protocols atomically", () =>
  Effect.gen(function* () {
    const store = yield* makeWorkspaceHubStore;
    yield* store.save(record("note"));
    for (const change of [
      record("bad", "note", { projectIds: ["missing"] }),
      record("bad", "note", { projectIds: ["note"] }),
      record("bad", "note", { relatedIds: ["bad"] }),
      record("bad", "note", { clientIds: ["missing"] }),
      record("bad", "note", { workspaceIds: ["missing"] }),
      record("bad", "note", { threadIds: ["missing"] }),
      record("bad", "task", { dueDate: "2026-02-30" }),
      record("bad", "task", { status: "active" }),
      record("bad", "note", { title: " " }),
      record("bad", "note", { resources: [{ label: "Bad link", url: "javascript:alert(1)" }] }),
    ])
      assert.equal((yield* Effect.result(store.save(change)))._tag, "Failure");
    assert.equal((yield* store.list({ search: "" })).items.length, 1);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("exports full records including archived items and relationships", () =>
  Effect.gen(function* () {
    const store = yield* makeWorkspaceHubStore;
    yield* store.save(record("project", "project", { contacts: "Pat: pat@example.com" }));
    yield* store.save(
      record("note", "note", {
        projectIds: ["project"],
        archived: true,
        body: "French: Québec\n- [ ] Follow up",
        resources: [{ label: "Reference", url: "https://example.com" }],
      }),
    );
    const exported = yield* store.exportData();
    assert.equal(exported.format, "t3-workspace-v1");
    assert.equal(exported.items.length, 2);
    assert.equal(
      exported.items.find((item) => item.id === "note")?.body,
      "French: Québec\n- [ ] Follow up",
    );
    assert.deepEqual(exported.items.find((item) => item.id === "note")?.projectIds, ["project"]);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect(
  "allocates a time entry to one project without multiplying billing for shared tasks",
  () =>
    Effect.gen(function* () {
      const hub = yield* makeWorkspaceHubStore;
      const time = yield* makeTimeTrackingStore;
      yield* time.mutate({
        type: "client.save",
        id: "client",
        name: "Client",
        color: "#6366f1",
        archived: false,
        hourlyRateCents: 10000,
        currency: "CAD",
        version: 0,
      });
      yield* hub.save(record("alpha", "project", { clientIds: ["client"] }));
      yield* hub.save(record("beta", "project", { clientIds: ["client"] }));
      const entry = {
        type: "entry.save",
        id: "time",
        version: 0,
        clientId: "client",
        projectId: "alpha",
        date: "2026-11-05",
        startMinute: 600,
        endMinute: 720,
        task: "Shared work",
        notes: "",
      } as const;
      yield* time.mutate(entry);
      const range = { from: "2026-11-01", to: "2026-11-30", clientIds: null };
      assert.equal(
        (yield* time.report({ ...range, projectId: "alpha" })).rows[0]?.amountCents,
        20000,
      );
      assert.equal((yield* time.report({ ...range, projectId: "beta" })).rows.length, 0);
      assert.equal((yield* time.report(range)).rows[0]?.minutes, 120);
      // Older clients omit the new field. Their edits must preserve the allocation.
      const { projectId: _, ...oldClientEntry } = entry;
      yield* time.mutate({ ...oldClientEntry, version: 1, notes: "Changed remotely" });
      assert.equal((yield* time.list(range)).entries[0]?.projectId, "alpha");
      yield* time.mutate({ ...entry, version: 2, projectId: null });
      assert.equal((yield* time.report({ ...range, projectId: "alpha" })).rows.length, 0);
      assert.equal((yield* time.report(range)).rows[0]?.amountCents, 20000);
      assert.equal(
        (yield* Effect.result(time.mutate({ ...entry, id: "invalid", projectId: "missing" })))._tag,
        "Failure",
      );
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("searches French text independent of accents and case", () =>
  Effect.gen(function* () {
    const store = yield* makeWorkspaceHubStore;
    yield* store.save(
      record("brief", "note", { title: "QUÉBEC – Échéancier", body: "Réunion mardi" }),
    );
    assert.equal((yield* store.list({ search: "quebec" })).items[0]?.id, "brief");
    assert.equal((yield* store.list({ search: "RÉUNION" })).items[0]?.id, "brief");
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

const seedFolder = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
    VALUES (${id}, ${id}, ${"/tmp/" + id}, '[]', '2026-11-01', '2026-11-01')`;
  });

const clientChange = (id: string) => ({
  type: "client.save" as const,
  id,
  name: id,
  color: "#6366f1",
  archived: false,
  hourlyRateCents: 10000,
  currency: "CAD" as const,
  version: 0,
});

it.effect(
  "moves a project durably without changing its content, relationships or past billing",
  () =>
    Effect.gen(function* () {
      yield* seedFolder("folder");
      yield* seedFolder("design");
      yield* seedChat;
      const hub = yield* makeWorkspaceHubStore;
      const time = yield* makeTimeTrackingStore;
      yield* time.mutate(clientChange("alpha"));
      yield* time.mutate({ ...clientChange("beta"), hourlyRateCents: 20000 });
      const project = yield* hub.save(
        record("project", "project", {
          clientIds: ["alpha"],
          workspaceIds: ["folder", "design"],
          chatIds: ["chat"],
          contacts: "Pat",
          resources: [{ label: "Reference", url: "https://example.com" }],
          pinned: true,
          tags: ["consulting"],
        }),
      );
      const note = yield* hub.save(
        record("note", "note", { projectIds: [project.id], aiContext: true }),
      );
      yield* time.mutate({
        type: "entry.save",
        id: "time",
        version: 0,
        clientId: "alpha",
        projectId: project.id,
        date: "2026-11-05",
        startMinute: 600,
        endMinute: 720,
        task: "Work",
        notes: "",
      });
      const context = yield* hub.chatContext({ threadId: ThreadId.make("chat") });
      const range = { from: "2026-11-01", to: "2026-11-30", clientIds: null };
      const entry = (yield* time.list(range)).entries[0];
      const moved = yield* hub.moveProject({
        id: project.id,
        version: project.version,
        clientId: "beta",
      });
      assert.equal("body" in moved, false);
      const reopened = yield* makeWorkspaceHubStore;
      assert.deepEqual(yield* reopened.get({ id: project.id }), {
        ...project,
        clientIds: ["beta"],
        version: project.version + 1,
        updatedAt: moved.updatedAt,
      });
      assert.deepEqual((yield* reopened.list({ search: "consulting" })).items, [moved]);
      assert.deepEqual(yield* reopened.get({ id: note.id }), note);
      assert.deepEqual(yield* reopened.chatContext({ threadId: ThreadId.make("chat") }), {
        ...context,
        sources: context.sources.map((source) =>
          source.id === project.id ? { ...source, version: moved.version } : source,
        ),
        text: context.text.replace(
          `## project: project (revision ${project.version})`,
          `## project: project (revision ${moved.version})`,
        ),
      });
      assert.deepEqual((yield* time.list(range)).entries[0], entry);
      assert.equal((yield* time.report(range)).rows[0]?.amountCents, 20000);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("allows moving back or removing the client and does not revise a no-op move", () =>
  Effect.gen(function* () {
    const hub = yield* makeWorkspaceHubStore;
    const time = yield* makeTimeTrackingStore;
    yield* time.mutate(clientChange("client"));
    const project = yield* hub.save(record("project", "project", { clientIds: ["client"] }));
    const same = yield* hub.moveProject({
      id: project.id,
      version: project.version,
      clientId: "client",
    });
    assert.equal(same.version, project.version);
    const personal = yield* hub.moveProject({
      id: project.id,
      version: same.version,
      clientId: null,
    });
    assert.deepEqual(personal.clientIds, []);
    assert.equal(personal.version, project.version + 1);
    const restored = yield* hub.moveProject({
      id: project.id,
      version: personal.version,
      clientId: "client",
    });
    assert.deepEqual((yield* hub.get({ id: project.id })).clientIds, ["client"]);
    assert.equal(restored.version, personal.version + 1);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("rejects stale, unavailable and archived move targets without changing saved data", () =>
  Effect.gen(function* () {
    const hub = yield* makeWorkspaceHubStore;
    const time = yield* makeTimeTrackingStore;
    yield* time.mutate(clientChange("active"));
    yield* time.mutate({ ...clientChange("archived"), archived: true });
    const project = yield* hub.save(record("project", "project"));
    yield* hub.save(record("note"));
    yield* hub.save(record("archived-project", "project", { archived: true }));
    const latest = yield* hub.save({ ...project, body: "Edited on another device" });
    const before = (yield* hub.exportData()).items;
    for (const input of [
      { id: project.id, version: project.version, clientId: "active" },
      { id: project.id, version: latest.version, clientId: "missing" },
      { id: project.id, version: latest.version, clientId: "archived" },
      { id: "missing", version: 1, clientId: "active" },
      { id: "note", version: 1, clientId: "active" },
      { id: "archived-project", version: 1, clientId: "active" },
    ]) {
      assert.equal((yield* Effect.result(hub.moveProject(input)))._tag, "Failure");
      assert.deepEqual((yield* hub.exportData()).items, before);
    }
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("moves projects even when an unrelated linked chat or folder was deleted", () =>
  Effect.gen(function* () {
    yield* seedFolder("folder");
    yield* seedChat;
    const hub = yield* makeWorkspaceHubStore;
    const time = yield* makeTimeTrackingStore;
    yield* time.mutate(clientChange("client"));
    const project = yield* hub.save(
      record("project", "project", { workspaceIds: ["folder"], chatIds: ["chat"] }),
    );
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE projection_threads SET deleted_at = '2026-11-08' WHERE thread_id = 'chat'`;
    yield* sql`UPDATE projection_projects SET deleted_at = '2026-11-08' WHERE project_id = 'folder'`;
    yield* hub.moveProject({ id: project.id, version: project.version, clientId: "client" });
    const saved = yield* hub.get({ id: project.id });
    assert.deepEqual(saved.clientIds, ["client"]);
    assert.deepEqual(saved.chatIds, ["chat"]);
    assert.deepEqual(saved.workspaceIds, ["folder"]);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect(
  "saves a new working folder while preserving existing links to deleted chats and folders",
  () =>
    Effect.gen(function* () {
      yield* seedFolder("folder");
      yield* seedFolder("new-folder");
      yield* seedChat;
      const hub = yield* makeWorkspaceHubStore;
      const sql = yield* SqlClient.SqlClient;
      const project = yield* hub.save(
        record("project", "project", {
          workspaceIds: ["folder"],
          chatIds: ["chat"],
          threadIds: ["chat"],
        }),
      );
      yield* sql`UPDATE projection_threads SET deleted_at = '2026-11-09' WHERE thread_id = 'chat'`;
      const saved = yield* hub.save({ ...project, workspaceIds: ["folder", "new-folder"] });
      assert.deepEqual(saved.workspaceIds, ["folder", "new-folder"]);
      assert.deepEqual(saved.chatIds, ["chat"]);
      assert.deepEqual(saved.threadIds, ["chat"]);

      yield* sql`UPDATE projection_projects SET deleted_at = '2026-11-09' WHERE project_id = 'folder'`;
      const { chatIds: _, ...legacyInput } = saved;
      const edited = yield* hub.save({ ...legacyInput, body: "Updated brief" });
      assert.deepEqual(edited.chatIds, ["chat"]);
      assert.deepEqual(edited.workspaceIds, ["folder", "new-folder"]);
      assert.equal(edited.version, project.version + 2);
      const reopened = yield* makeWorkspaceHubStore;
      assert.deepEqual(yield* reopened.get({ id: project.id }), edited);

      // Keeping the relationship lets a restored chat rejoin its project.
      yield* sql`UPDATE projection_threads SET deleted_at = NULL WHERE thread_id = 'chat'`;
      const context = yield* reopened.chatContext({ threadId: ThreadId.make("chat") });
      assert.deepEqual(
        context.projects.map((project) => project.id),
        ["project"],
      );
      assert.ok(context.text.includes("Updated brief"));
      assert.deepEqual(
        context.folders?.map((folder) => folder.id),
        ["new-folder"],
      );
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect(
  "still rejects new unavailable links atomically, including relinking a removed chat",
  () =>
    Effect.gen(function* () {
      yield* seedFolder("folder");
      yield* seedChat;
      const hub = yield* makeWorkspaceHubStore;
      const sql = yield* SqlClient.SqlClient;
      const project = yield* hub.save(record("project", "project", { chatIds: ["chat"] }));
      yield* sql`UPDATE projection_threads SET deleted_at = '2026-11-09' WHERE thread_id = 'chat'`;
      yield* sql`UPDATE projection_projects SET deleted_at = '2026-11-09' WHERE project_id = 'folder'`;
      for (const extra of [
        { chatIds: ["chat", "missing"] },
        { threadIds: ["chat"] },
        { threadIds: ["missing"] },
        { workspaceIds: ["folder"] },
        { workspaceIds: ["missing"] },
      ]) {
        assert.equal(
          (yield* Effect.result(hub.save({ ...project, title: "Must not save", ...extra })))._tag,
          "Failure",
        );
        assert.deepEqual(yield* hub.get({ id: project.id }), project);
      }
      const unlinked = yield* hub.save({ ...project, chatIds: [] });
      assert.deepEqual(unlinked.chatIds, []);
      assert.equal(
        (yield* Effect.result(hub.save({ ...unlinked, chatIds: ["chat"] })))._tag,
        "Failure",
      );
      assert.equal(
        (yield* Effect.result(hub.save({ ...project, body: "Stale edit" })))._tag,
        "Failure",
      );
      assert.deepEqual(yield* hub.get({ id: project.id }), unlinked);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("promotes an existing folder once and reuses its existing project", () =>
  Effect.gen(function* () {
    yield* seedFolder("folder");
    yield* seedChat;
    const hub = yield* makeWorkspaceHubStore;
    const first = yield* hub.ensureProject({ workspaceId: ProjectId.make("folder") });
    const second = yield* hub.ensureProject({ workspaceId: ProjectId.make("folder") });
    assert.equal(second.id, first.id);
    assert.equal(second.version, first.version);
    assert.equal((yield* hub.list({ search: "" })).items.length, 1);
    assert.deepEqual(
      (yield* hub.chatContext({ threadId: ThreadId.make("chat") })).projects.map((p) => p.id),
      [first.id],
    );
    assert.equal(
      (yield* Effect.result(hub.ensureProject({ workspaceId: ProjectId.make("missing") })))._tag,
      "Failure",
    );
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect(
  "inherits multi-folder project notes, honors explicit membership and reverses unlinking",
  () =>
    Effect.gen(function* () {
      yield* seedFolder("folder");
      yield* seedFolder("design");
      yield* seedChat;
      const hub = yield* makeWorkspaceHubStore;
      const alpha = yield* hub.save(
        record("alpha", "project", { workspaceIds: ["folder", "design"] }),
      );
      yield* hub.save(
        record("shared", "note", {
          projectIds: ["alpha"],
          aiContext: true,
          body: "Shared instructions",
        }),
      );
      assert.equal(
        (yield* hub.ensureProject({ workspaceId: ProjectId.make("design") })).id,
        alpha.id,
      );
      let context = yield* hub.chatContext({ threadId: ThreadId.make("chat") });
      assert.deepEqual(context.folders?.map((f) => f.id).sort(), ["design", "folder"]);
      assert.ok(context.text.includes("Shared instructions"));
      const beta = yield* hub.save(
        record("beta", "project", { chatIds: ["chat"], body: "Explicit membership" }),
      );
      context = yield* hub.chatContext({ threadId: ThreadId.make("chat") });
      assert.deepEqual(
        context.projects.map((p) => p.id),
        [beta.id],
      );
      assert.equal(context.text.includes("Shared instructions"), false);
      yield* hub.save({ ...beta, archived: true });
      const excluded = yield* hub.save({ ...alpha, excludedChatIds: ["chat"] });
      context = yield* hub.chatContext({ threadId: ThreadId.make("chat") });
      assert.deepEqual(context.projects, []);
      assert.equal(context.text.includes("Shared instructions"), false);
      const { excludedChatIds: _, ...legacy } = excluded;
      const preserved = yield* hub.save(legacy);
      assert.deepEqual(preserved.excludedChatIds, ["chat"]);
      const restored = yield* hub.attachChat(alpha.id, "chat");
      assert.deepEqual(restored.excludedChatIds, []);
      assert.ok(
        (yield* hub.chatContext({ threadId: ThreadId.make("chat") })).text.includes(
          "Shared instructions",
        ),
      );
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);
