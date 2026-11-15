import { assert, it } from "@effect/vitest";
import {
  CommandId,
  FREE_CHAT_WORKSPACE_ID,
  clientChatWorkspaceId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  ThreadId,
  type HubSaveInput,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../orchestration/ThreadPlanProgress.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import { makeProviderRegistryLayer } from "../provider/testUtils/providerRegistryMock.ts";
import { OrchestrationEventStoreLive } from "./Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "./Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "./Layers/Sqlite.ts";
import { makeWorkspaceHubStore } from "./WorkspaceHub.ts";
import { makeWorkspaceHubChats } from "./WorkspaceHubChats.ts";
import { normalizeDispatchCommand } from "../orchestration/Normalizer.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { makeTimeTrackingStore } from "./TimeTracking.ts";
import { makeHubChatDefaults } from "./HubChatDefaults.ts";

const accounts: ServerProvider[] = [
  ["codex", "codex"],
  ["codex_work", "codex"],
  ["claude_work", "claudeAgent"],
  ["opencode_work", "opencode"],
  ["disabled", "codex"],
].map(([id, driver]) => ({
  instanceId: ProviderInstanceId.make(id!),
  driver: ProviderDriverKind.make(driver!),
  displayName: id!,
  enabled: id !== "disabled",
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-08T12:00:00.000Z",
  models: [
    { slug: "test-model", name: "Test model", isCustom: false, isDefault: true, capabilities: {} },
  ],
  slashCommands: [],
  skills: [],
}));

const layer = Layer.mergeAll(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
  ),
  OrchestrationProjectionSnapshotQueryLive,
).pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(
    ServerSettingsService.layerTest({
      defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
      providerInstances: Object.fromEntries(
        accounts.map((account) => [
          account.instanceId,
          {
            driver: account.driver,
            enabled: account.enabled,
          },
        ]),
      ),
    }),
  ),
  Layer.provideMerge(makeProviderRegistryLayer(accounts)),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-hub-chats-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

it.effect(
  "keeps an existing project's chats in their working folder and honors a new default",
  () =>
    Effect.gen(function* () {
      const hub = yield* makeWorkspaceHubStore;
      const create = yield* makeWorkspaceHubChats;
      const engine = yield* OrchestrationEngineService;
      const fs = yield* FileSystem.FileSystem;
      const snapshots = yield* ProjectionSnapshotQuery;
      const root = yield* fs.makeTempDirectoryScoped();
      const workspaceId = ProjectId.make("sprintsync-board");
      const command = yield* normalizeDispatchCommand({
        type: "project.create",
        commandId: CommandId.make("new-working-folder"),
        projectId: workspaceId,
        title: "sprintsync-board",
        workspaceRoot: `${root}/new project/sprintsync-board`,
        createWorkspaceRootIfMissing: true,
        createdAt: "2026-11-08T12:00:00.000Z",
      });
      yield* engine.dispatch(command);
      assert.equal(yield* fs.exists(`${root}/new project/sprintsync-board`), true);
      yield* hub.save(project("humanos"));
      const first = yield* create({
        projectId: "humanos",
        threadId: ThreadId.make("original"),
        workspaceId,
      });
      const next = yield* create({ projectId: "humanos", threadId: ThreadId.make("next") });
      assert.equal(first.workspaceId, next.workspaceId);
      assert.equal(next.workspaceId, workspaceId);
      const otherId = ProjectId.make("second-folder");
      yield* engine.dispatch({
        ...command,
        type: "project.create",
        commandId: CommandId.make("second"),
        projectId: otherId,
        title: "second",
        workspaceRoot: root,
        createdAt: "2026-11-08T12:00:00.000Z",
      });
      const current = yield* hub.get({ id: "humanos" });
      yield* hub.save({ ...current, workspaceIds: [otherId] });
      assert.equal(
        (yield* create({ projectId: "humanos", threadId: ThreadId.make("third") })).workspaceId,
        otherId,
      );
      assert.equal(
        Option.getOrThrow(yield* snapshots.getThreadShellById(first.threadId)).projectId,
        workspaceId,
      );
    }).pipe(Effect.provide(layer)),
);
const project = (id: string): HubSaveInput => ({
  id,
  kind: "project",
  title: id,
  body: "Brief",
  contacts: "",
  resources: [],
  clientIds: [],
  projectIds: [],
  workspaceIds: [],
  threadIds: [],
  relatedIds: [],
  tags: [],
  folder: "",
  pinned: true,
  archived: false,
  status: "active",
  priority: "normal",
  dueDate: null,
  version: 0,
});

const client = (id: string, account: string | null) => ({
  type: "client.save" as const,
  id,
  name: id,
  color: "#6366f1",
  archived: false,
  version: 0,
  defaultModelSelection: account
    ? { instanceId: ProviderInstanceId.make(account), model: "test-model" }
    : null,
});

it.effect(
  "new client chats use the exact account while unassigned chats use the general default",
  () =>
    Effect.gen(function* () {
      const hub = yield* makeWorkspaceHubStore;
      const time = yield* makeTimeTrackingStore;
      const create = yield* makeWorkspaceHubChats;
      const snapshots = yield* ProjectionSnapshotQuery;
      const defaults = yield* makeHubChatDefaults;
      for (const [id, account] of [
        ["alpha", "codex_work"],
        ["beta", "claude_work"],
        ["gamma", "opencode_work"],
        ["inherit", null],
      ] as const) {
        yield* time.mutate(client(id, account));
        yield* hub.save({ ...project(id), clientIds: [id] });
        const created = yield* create({ projectId: id, threadId: ThreadId.make(id) });
        const thread = Option.getOrThrow(yield* snapshots.getThreadShellById(created.threadId));
        assert.equal(thread.modelSelection.instanceId, account ?? "codex");
        assert.equal(
          (yield* defaults({ workspaceId: created.workspaceId })).modelSelection?.instanceId,
          account ?? "codex",
        );
      }
      yield* hub.save(project("personal"));
      for (const id of ["personal", null]) {
        const created = yield* create({ projectId: id, threadId: ThreadId.make(id ?? "free") });
        assert.equal(
          Option.getOrThrow(yield* snapshots.getThreadShellById(created.threadId)).modelSelection
            .instanceId,
          "codex",
        );
      }
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "moving a project changes defaults for future chats and never switches existing conversations",
  () =>
    Effect.gen(function* () {
      const hub = yield* makeWorkspaceHubStore;
      const time = yield* makeTimeTrackingStore;
      const create = yield* makeWorkspaceHubChats;
      const defaults = yield* makeHubChatDefaults;
      const snapshots = yield* ProjectionSnapshotQuery;
      yield* time.mutate(client("alpha", "codex_work"));
      yield* time.mutate(client("beta", "claude_work"));
      const saved = yield* hub.save({ ...project("hub"), clientIds: ["alpha"] });
      const first = yield* create({ projectId: saved.id, threadId: ThreadId.make("first") });
      const current = yield* hub.get({ id: saved.id });
      yield* hub.moveProject({ id: saved.id, version: current.version, clientId: "beta" });
      const next = yield* create({ projectId: saved.id, threadId: ThreadId.make("next") });
      assert.equal(
        Option.getOrThrow(yield* snapshots.getThreadShellById(next.threadId)).modelSelection
          .instanceId,
        "claude_work",
      );
      yield* create({ projectId: saved.id, threadId: first.threadId });
      assert.equal(
        Option.getOrThrow(yield* snapshots.getThreadShellById(first.threadId)).modelSelection
          .instanceId,
        "codex_work",
      );
      yield* time.mutate({ ...client("beta", null), version: 1 });
      assert.equal(
        (yield* defaults({ workspaceId: first.workspaceId })).modelSelection?.instanceId,
        "codex",
      );
      const inherited = yield* create({
        projectId: saved.id,
        threadId: ThreadId.make("inherited"),
      });
      assert.equal(
        Option.getOrThrow(yield* snapshots.getThreadShellById(inherited.threadId)).modelSelection
          .instanceId,
        "codex",
      );
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "unavailable client accounts block new chats instead of falling back to another account",
  () =>
    Effect.gen(function* () {
      const hub = yield* makeWorkspaceHubStore;
      const time = yield* makeTimeTrackingStore;
      const create = yield* makeWorkspaceHubChats;
      const defaults = yield* makeHubChatDefaults;
      const snapshots = yield* ProjectionSnapshotQuery;
      for (const account of ["missing", "disabled"]) {
        yield* time.mutate(client(account, account));
        yield* hub.save({ ...project(account), clientIds: [account] });
        const policy = yield* defaults({ projectId: account });
        assert.equal(policy.modelSelection?.instanceId, account);
        assert.ok(policy.unavailableReason?.includes("unavailable"));
        assert.equal(
          (yield* Effect.result(create({ projectId: account, threadId: ThreadId.make(account) })))
            ._tag,
          "Failure",
        );
      }
      assert.equal((yield* snapshots.getSnapshot()).threads.length, 0);
      assert.equal((yield* snapshots.getSnapshot()).projects.length, 0);
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "folder defaults follow stable project ownership and free chats never inherit a linked project's account",
  () =>
    Effect.gen(function* () {
      const hub = yield* makeWorkspaceHubStore;
      const time = yield* makeTimeTrackingStore;
      const create = yield* makeWorkspaceHubChats;
      const defaults = yield* makeHubChatDefaults;
      const settings = yield* ServerSettingsService;
      yield* time.mutate(client("alpha", "codex_work"));
      yield* time.mutate(client("beta", "claude_work"));
      yield* hub.save({ ...project("a"), clientIds: ["alpha"] });
      const first = yield* create({ projectId: "a", threadId: ThreadId.make("first") });
      yield* hub.save({ ...project("b"), clientIds: ["beta"], workspaceIds: [first.workspaceId] });
      assert.equal(
        (yield* defaults({ workspaceId: first.workspaceId })).modelSelection?.instanceId,
        "codex_work",
      );
      const free = yield* create({ projectId: null, threadId: ThreadId.make("free") });
      yield* hub.attachChat("a", free.threadId);
      assert.equal(
        (yield* defaults({ workspaceId: FREE_CHAT_WORKSPACE_ID })).modelSelection?.instanceId,
        "codex",
      );
      yield* settings.updateSettings({ defaultModelSelection: null });
      assert.equal((yield* defaults({ projectId: null })).modelSelection, null);
      const auto = yield* create({ projectId: null, threadId: ThreadId.make("automatic") });
      assert.equal(auto.workspaceId, FREE_CHAT_WORKSPACE_ID);
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "creates a chat workspace for a non-code hub, persists membership and retries without duplicates",
  () =>
    Effect.gen(function* () {
      const hub = yield* makeWorkspaceHubStore;
      const create = yield* makeWorkspaceHubChats;
      const snapshots = yield* ProjectionSnapshotQuery;
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig;
      yield* hub.save(project("consulting"));
      const input = { projectId: "consulting", threadId: ThreadId.make("new-hub-chat") };
      const result = yield* create(input);
      assert.deepEqual(yield* create(input), result);
      const workspace = Option.getOrThrow(yield* snapshots.getProjectShellById(result.workspaceId));
      assert.ok(workspace.workspaceRoot.startsWith(config.stateDir + "/hub-workspaces/"));
      assert.equal(yield* fs.exists(workspace.workspaceRoot), true);
      const thread = Option.getOrThrow(yield* snapshots.getThreadDetailById(result.threadId));
      assert.equal(thread.messages.length, 0);
      assert.equal(thread.session, null);
      assert.deepEqual((yield* hub.get({ id: input.projectId })).chatIds, [input.threadId]);
      const next = yield* create({ ...input, threadId: ThreadId.make("next-hub-chat") });
      assert.equal(next.workspaceId, result.workspaceId);
      assert.equal((yield* snapshots.getSnapshot()).threads.length, 2);
    }).pipe(Effect.provide(layer)),
);

it.effect("uses an explicit workspace and rejects archived hubs and missing folders", () =>
  Effect.gen(function* () {
    const hub = yield* makeWorkspaceHubStore;
    const create = yield* makeWorkspaceHubChats;
    const engine = yield* OrchestrationEngineService;
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const workspaceId = ProjectId.make("existing-folder");
    yield* engine.dispatch({
      type: "project.create",
      commandId: CommandId.make("create-folder"),
      projectId: workspaceId,
      title: "Existing folder",
      workspaceRoot: root,
      createdAt: "2026-11-03T12:00:00.000Z",
    });
    yield* hub.save(project("hub"));
    const result = yield* create({
      projectId: "hub",
      threadId: ThreadId.make("explicit"),
      workspaceId,
    });
    assert.equal(result.workspaceId, workspaceId);
    assert.equal(
      (yield* Effect.result(
        create({
          projectId: "hub",
          threadId: ThreadId.make("missing"),
          workspaceId: ProjectId.make("missing-folder"),
        }),
      ))._tag,
      "Failure",
    );
    const current = yield* hub.get({ id: "hub" });
    yield* hub.save({ ...current, archived: true });
    assert.equal(
      (yield* Effect.result(create({ projectId: "hub", threadId: ThreadId.make("archived") })))
        ._tag,
      "Failure",
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("creates free chats without a project and retries without duplicating them", () =>
  Effect.gen(function* () {
    const hub = yield* makeWorkspaceHubStore;
    const create = yield* makeWorkspaceHubChats;
    const snapshots = yield* ProjectionSnapshotQuery;
    const fs = yield* FileSystem.FileSystem;
    const input = { projectId: null, threadId: ThreadId.make("free-one") };
    const first = yield* create(input);
    assert.deepEqual(yield* create(input), first);
    assert.equal(first.workspaceId, FREE_CHAT_WORKSPACE_ID);
    const folder = Option.getOrThrow(yield* snapshots.getProjectShellById(first.workspaceId));
    assert.equal(yield* fs.exists(folder.workspaceRoot), true);
    const second = yield* create({ projectId: null, threadId: ThreadId.make("free-two") });
    assert.equal(second.workspaceId, first.workspaceId);
    assert.equal((yield* snapshots.getSnapshot()).threads.length, 2);
    assert.equal((yield* hub.list({ search: "" })).items.length, 0);
    assert.equal((yield* hub.chatContext({ threadId: first.threadId })).text, "");
    assert.equal(
      (yield* Effect.result(hub.ensureProject({ workspaceId: first.workspaceId })))._tag,
      "Failure",
    );
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "links one free chat to a project without pulling in other free chats, and unlinks it again",
  () =>
    Effect.gen(function* () {
      const hub = yield* makeWorkspaceHubStore;
      const create = yield* makeWorkspaceHubChats;
      const first = yield* create({ projectId: null, threadId: ThreadId.make("free-one") });
      const second = yield* create({ projectId: null, threadId: ThreadId.make("free-two") });
      yield* hub.save(project("client-project"));
      const linked = yield* hub.attachChat("client-project", first.threadId);
      const context = yield* hub.chatContext({ threadId: first.threadId });
      assert.deepEqual(
        context.projects.map((p) => p.id),
        ["client-project"],
      );
      assert.ok(context.text.includes("Brief"));
      assert.deepEqual(context.folders, []);
      assert.equal((yield* hub.chatContext({ threadId: second.threadId })).text, "");
      const projectChat = yield* create({
        projectId: linked.id,
        threadId: ThreadId.make("project-chat"),
      });
      assert.notEqual(projectChat.workspaceId, FREE_CHAT_WORKSPACE_ID);
      const current = yield* hub.get({ id: linked.id });
      yield* hub.save({
        ...current,
        chatIds: current.chatIds.filter((id) => id !== first.threadId),
        excludedChatIds: [first.threadId],
      });
      assert.equal((yield* hub.chatContext({ threadId: first.threadId })).text, "");
      assert.equal(
        (yield* Effect.result(create({ projectId: null, threadId: projectChat.threadId })))._tag,
        "Failure",
      );
      assert.equal(
        (yield* Effect.result(
          hub.save({ ...project("invalid"), workspaceIds: [FREE_CHAT_WORKSPACE_ID] }),
        ))._tag,
        "Failure",
      );
    }).pipe(Effect.provide(layer)),
);

it.effect("concurrent free chats share one working space without creating duplicate projects", () =>
  Effect.gen(function* () {
    const create = yield* makeWorkspaceHubChats;
    const snapshots = yield* ProjectionSnapshotQuery;
    const results = yield* Effect.all(
      [
        create({ projectId: null, threadId: ThreadId.make("parallel-one") }),
        create({ projectId: null, threadId: ThreadId.make("parallel-two") }),
      ],
      { concurrency: 2 },
    );
    assert.equal(results[0].workspaceId, results[1].workspaceId);
    const snapshot = yield* snapshots.getSnapshot();
    assert.equal(snapshot.projects.length, 1);
    assert.equal(snapshot.threads.length, 2);
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "creates durable chats directly under each client using its exact account or the general default",
  () =>
    Effect.gen(function* () {
      const time = yield* makeTimeTrackingStore;
      const hub = yield* makeWorkspaceHubStore;
      const create = yield* makeWorkspaceHubChats;
      const snapshots = yield* ProjectionSnapshotQuery;
      const defaults = yield* makeHubChatDefaults;
      for (const [id, account] of [
        ["alpha", "codex_work"],
        ["beta", "claude_work"],
        ["inherit", null],
      ] as const) {
        yield* time.mutate(client(id, account));
        const input = { projectId: null, clientId: id, threadId: ThreadId.make(`direct-${id}`) };
        const first = yield* create(input);
        assert.equal(first.workspaceId, clientChatWorkspaceId(id));
        assert.deepEqual(yield* create(input), first);
        const thread = Option.getOrThrow(yield* snapshots.getThreadShellById(first.threadId));
        assert.equal(thread.modelSelection.instanceId, account ?? "codex");
        assert.equal(
          (yield* defaults({ workspaceId: first.workspaceId })).modelSelection?.instanceId,
          account ?? "codex",
        );
      }
      assert.equal((yield* hub.list({ search: "" })).items.length, 0);
      const reopened = yield* makeWorkspaceHubChats;
      const next = yield* reopened({
        projectId: null,
        clientId: "alpha",
        threadId: ThreadId.make("another"),
      });
      assert.equal(next.workspaceId, clientChatWorkspaceId("alpha"));
      yield* time.mutate({
        ...client("alpha", "opencode_work"),
        version: 1,
        name: "Renamed client",
      });
      yield* reopened({
        projectId: null,
        clientId: "alpha",
        threadId: ThreadId.make("direct-alpha"),
      });
      assert.equal(
        Option.getOrThrow(yield* snapshots.getThreadShellById(ThreadId.make("direct-alpha")))
          .modelSelection.instanceId,
        "codex_work",
      );
      const newer = yield* reopened({
        projectId: null,
        clientId: "alpha",
        threadId: ThreadId.make("new-default"),
      });
      assert.equal(
        Option.getOrThrow(yield* snapshots.getThreadShellById(newer.threadId)).modelSelection
          .instanceId,
        "opencode_work",
      );
      assert.equal(
        (yield* hub.chatContext({ threadId: newer.threadId })).client?.name,
        "Renamed client",
      );
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "rejects unavailable or mixed client targets and restores archived clients without losing chats",
  () =>
    Effect.gen(function* () {
      const time = yield* makeTimeTrackingStore;
      const hub = yield* makeWorkspaceHubStore;
      const create = yield* makeWorkspaceHubChats;
      const snapshots = yield* ProjectionSnapshotQuery;
      yield* time.mutate(client("alpha", "codex_work"));
      yield* time.mutate(client("beta", "claude_work"));
      yield* time.mutate(client("disabled", "disabled"));
      yield* hub.save(project("project"));
      const original = { projectId: null, clientId: "alpha", threadId: ThreadId.make("original") };
      const created = yield* create(original);
      for (const input of [
        { projectId: null, clientId: "missing", threadId: ThreadId.make("missing") },
        { projectId: null, clientId: "disabled", threadId: ThreadId.make("disabled") },
        { projectId: "project", clientId: "alpha", threadId: ThreadId.make("mixed") },
        {
          projectId: null,
          clientId: "alpha",
          workspaceId: FREE_CHAT_WORKSPACE_ID,
          threadId: ThreadId.make("bad-folder"),
        },
        { projectId: null, clientId: "beta", threadId: original.threadId },
        { projectId: null, threadId: original.threadId },
      ])
        assert.equal((yield* Effect.result(create(input)))._tag, "Failure");
      yield* time.mutate({ ...client("alpha", "codex_work"), version: 1, archived: true });
      assert.deepEqual(yield* create(original), created);
      assert.equal(
        (yield* Effect.result(create({ ...original, threadId: ThreadId.make("archived") })))._tag,
        "Failure",
      );
      yield* time.mutate({ ...client("alpha", "codex_work"), version: 2 });
      yield* create({ ...original, threadId: ThreadId.make("restored") });
      assert.equal((yield* snapshots.getSnapshot()).threads.length, 2);
      assert.equal(
        (yield* Effect.result(hub.ensureProject({ workspaceId: created.workspaceId })))._tag,
        "Failure",
      );
      assert.equal(
        (yield* Effect.result(
          hub.save({ ...project("invalid"), workspaceIds: [created.workspaceId] }),
        ))._tag,
        "Failure",
      );
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "concurrent client chats share private working space without creating a hub project",
  () =>
    Effect.gen(function* () {
      const time = yield* makeTimeTrackingStore;
      yield* time.mutate(client("alpha", "codex_work"));
      const create = yield* makeWorkspaceHubChats;
      const snapshots = yield* ProjectionSnapshotQuery;
      const results = yield* Effect.all(
        ["one", "two"].map((id) =>
          create({ projectId: null, clientId: "alpha", threadId: ThreadId.make(id) }),
        ),
        { concurrency: 2 },
      );
      assert.equal(results[0]!.workspaceId, results[1]!.workspaceId);
      assert.equal((yield* snapshots.getSnapshot()).projects.length, 1);
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "client context shares a bounded project overview and marked client notes, with deeper project context only when linked",
  () =>
    Effect.gen(function* () {
      const time = yield* makeTimeTrackingStore;
      const hub = yield* makeWorkspaceHubStore;
      const create = yield* makeWorkspaceHubChats;
      yield* time.mutate(client("alpha", "codex_work"));
      yield* time.mutate(client("beta", "claude_work"));
      const clientChat = yield* create({
        projectId: null,
        clientId: "alpha",
        threadId: ThreadId.make("client-chat"),
      });
      const saved = yield* hub.save({
        ...project("alpha-project"),
        clientIds: ["alpha"],
        body: "Project summary",
      });
      yield* hub.save({
        ...project("beta-project"),
        clientIds: ["beta"],
        body: "OTHER CLIENT BRIEF",
      });
      yield* hub.save({
        ...project("archived-project"),
        clientIds: ["alpha"],
        archived: true,
        body: "ARCHIVED BRIEF",
      });
      for (const [id, extra] of [
        ["client-note", { clientIds: ["alpha"], aiContext: true, body: "Client instructions" }],
        ["private-note", { clientIds: ["alpha"], aiContext: false, body: "PRIVATE NOTE" }],
        ["other-note", { clientIds: ["beta"], aiContext: true, body: "OTHER CLIENT NOTE" }],
        [
          "project-note",
          { projectIds: [saved.id], aiContext: true, body: "Detailed project instructions" },
        ],
      ] as const)
        yield* hub.save({ ...project(id), kind: "note", ...extra });
      let context = yield* hub.chatContext({ threadId: clientChat.threadId });
      assert.deepEqual(context.client, { id: "alpha", name: "alpha" });
      assert.deepEqual(context.projects, []);
      assert.deepEqual(context.folders, []);
      assert.ok(context.text.includes("Project summary"));
      assert.ok(context.text.includes("Client instructions"));
      for (const absent of [
        "OTHER CLIENT",
        "PRIVATE NOTE",
        "ARCHIVED BRIEF",
        "Detailed project instructions",
      ])
        assert.equal(context.text.includes(absent), false);
      const attached = yield* hub.attachChat(saved.id, clientChat.threadId);
      context = yield* hub.chatContext({ threadId: clientChat.threadId });
      assert.ok(context.text.includes("Detailed project instructions"));
      assert.deepEqual(context.folders, []);
      const ordinary = yield* create({
        projectId: saved.id,
        threadId: ThreadId.make("project-chat"),
      });
      assert.notEqual(ordinary.workspaceId, clientChat.workspaceId);
      const current = yield* hub.get({ id: attached.id });
      yield* hub.save({ ...current, chatIds: [], body: "a".repeat(100000) });
      context = yield* hub.chatContext({ threadId: clientChat.threadId });
      assert.equal(context.text.includes("Detailed project instructions"), false);
      assert.equal(context.truncated, true);
      assert.ok(context.text.length < 40000);
    }).pipe(Effect.provide(layer)),
);
