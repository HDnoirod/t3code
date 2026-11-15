import { assert, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { layerMemory as SqlitePersistenceMemory } from "./Sqlite.ts";
import { makeWorkspaceHubStore } from "./WorkspaceHub.ts";
import { makeWorkspaceHubContext } from "./ProjectFolderContext.ts";

const layer = Layer.mergeAll(SqlitePersistenceMemory, NodeServices.layer);
const seed = (roots: string[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const [index, root] of roots.entries()) {
      yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
      VALUES (${"folder" + index}, ${"Folder " + index}, ${root}, '[]', '2026-11-01', '2026-11-01')`;
    }
    yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, payload_json, created_at, updated_at)
    VALUES ('chat', 'folder0', 'Chat', 'codex', 'full-access', 'default', '{}', '2026-11-01', '2026-11-01')`;
    const store = yield* makeWorkspaceHubStore;
    const project = yield* store.ensureProject({ workspaceId: ProjectId.make("folder0") });
    yield* store.save({ ...project, workspaceIds: roots.map((_, i) => "folder" + i) });
  });
const input = { threadId: ThreadId.make("chat") };

it.effect("includes a small folder overview without hidden files or arbitrary file contents", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(
      `${root}/README.md`,
      "Project goals\n" + "x".repeat(2000) + "END OF README",
    );
    yield* fs.writeFileString(`${root}/.env`, "SECRET ENV VALUE");
    yield* fs.writeFileString(`${root}/notes.txt`, "PRIVATE FILE CONTENT");
    yield* fs.makeDirectory(`${root}/node_modules`);
    yield* seed([root]);
    const context = yield* (yield* makeWorkspaceHubContext)(input);
    assert.ok(context.text.includes("Project goals"));
    assert.ok(context.text.includes("notes.txt"));
    for (const text of [
      "END OF README",
      "SECRET ENV VALUE",
      "PRIVATE FILE CONTENT",
      ".env",
      "node_modules",
    ])
      assert.equal(context.text.includes(text), false);
    assert.ok(context.text.length < 40_001);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("does not follow a README symlink outside its selected folder", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const selected = `${root}/selected`;
    yield* fs.makeDirectory(selected);
    yield* fs.writeFileString(`${root}/outside.md`, "OUTSIDE SECRET");
    yield* fs.symlink(`${root}/outside.md`, `${selected}/README.md`);
    yield* seed([selected]);
    assert.equal(
      (yield* (yield* makeWorkspaceHubContext)(input)).text.includes("OUTSIDE SECRET"),
      false,
    );
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("unavailable folders do not prevent sending project context", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* seed([`${root}/missing`]);
    const context = yield* (yield* makeWorkspaceHubContext)(input);
    assert.ok(context.text.includes("Folder overview unavailable"));
    assert.equal(context.folders?.length, 1);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("bounds folder scanning and skips oversized README files", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const roots: string[] = [];
    for (let index = 0; index < 5; index++) {
      const folder = `${root}/${index}`;
      yield* fs.makeDirectory(folder);
      yield* fs.writeFileString(
        `${folder}/README.md`,
        index === 0 ? "LARGE CONTENT".repeat(6000) : `README-${index}`,
      );
      roots.push(folder);
    }
    yield* seed(roots);
    const context = yield* (yield* makeWorkspaceHubContext)(input);
    assert.equal(context.text.includes("LARGE CONTENT"), false);
    assert.ok(context.text.includes("README-1"));
    assert.equal(context.text.includes("README-4"), false);
    assert.equal(context.truncated, true);
    assert.ok(context.text.length <= 40_000);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);
