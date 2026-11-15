import { describe, expect, it } from "vite-plus/test";
import {
  clientChatWorkspaceId,
  EnvironmentId,
  FREE_CHAT_WORKSPACE_ID,
  type HubSummary,
} from "@t3tools/contracts";
import { captureFiling, type CaptureLocation } from "./captureContext";
import { newHubItem, type CaptureRequest } from "./hub";

const environmentId = EnvironmentId.make("mac");
const remote = EnvironmentId.make("remote");
const project: HubSummary = {
  ...newHubItem("project"),
  id: "humanos",
  title: "HumanOS",
  clientIds: ["humanise"],
  workspaceIds: ["sprintsync"],
  chatIds: [],
  aiContext: false,
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
};
const thread = { id: "chat", projectId: "sprintsync", environmentId };
function filing(
  location: Partial<CaptureLocation>,
  request: CaptureRequest = {},
  items = [project],
  threads = [thread],
) {
  return captureFiling({
    location: { environmentId, pathname: "/hub", ...location },
    request: { environmentId, ...request },
    items,
    threads,
  });
}

describe("quick capture filing", () => {
  it("files project captures under the project without broadening them to every client chat", () => {
    expect(filing({ itemId: project.id, clientId: "humanise" })).toEqual({
      projectIds: ["humanos"],
      clientIds: [],
    });
  });
  it("files client-wide captures under the client", () => {
    expect(filing({ clientId: "humanise" })).toEqual({ projectIds: [], clientIds: ["humanise"] });
    expect(
      filing(
        { pathname: "/mac/chat", threadId: "chat" },
        {},
        [project],
        [{ ...thread, projectId: clientChatWorkspaceId("humanise") }],
      ),
    ).toEqual({ projectIds: [], clientIds: ["humanise"] });
  });
  it("uses the chat's stable sidebar home when projects overlap", () => {
    const other = { ...project, id: "shared", chatIds: ["chat"], createdAt: "2026-11-02" };
    const original = { ...project, chatIds: ["chat"] };
    expect(filing({ pathname: "/mac/chat", threadId: "chat" }, {}, [other, original])).toEqual({
      projectIds: ["humanos"],
      clientIds: [],
    });
  });
  it("keeps free chats and global captures in the inbox", () => {
    expect(filing({ pathname: "/notes", itemId: project.id })).toEqual({
      projectIds: [],
      clientIds: [],
    });
    expect(
      filing(
        { pathname: "/mac/chat", threadId: "chat" },
        {},
        [project],
        [{ ...thread, projectId: FREE_CHAT_WORKSPACE_ID }],
      ),
    ).toEqual({ projectIds: [], clientIds: [] });
  });
  it("honors explicit filing choices, including an empty selection", () => {
    expect(filing({ itemId: project.id }, { projectIds: [] })).toEqual({
      projectIds: [],
      clientIds: [],
    });
    expect(filing({ itemId: project.id }, { clientIds: ["other"] })).toEqual({
      projectIds: [],
      clientIds: ["other"],
    });
  });
  it("never takes a client or project from a different environment", () => {
    expect(filing({ environmentId: remote, itemId: project.id, clientId: "humanise" })).toEqual({
      projectIds: [],
      clientIds: [],
    });
    expect(
      filing({ threadId: "chat" }, {}, [project], [{ ...thread, environmentId: remote }]),
    ).toEqual({ projectIds: [], clientIds: [] });
  });
  it("can file a saved response by its explicit source chat", () => {
    expect(filing({ pathname: "/notes" }, { threadId: "chat" })).toEqual({
      projectIds: ["humanos"],
      clientIds: [],
    });
  });
  it("does not file captures into archived or unavailable projects", () => {
    expect(filing({ itemId: project.id }, {}, [{ ...project, archived: true }])).toEqual({
      projectIds: [],
      clientIds: [],
    });
    expect(filing({ itemId: "deleted", clientId: "humanise" })).toEqual({
      projectIds: [],
      clientIds: [],
    });
  });
});
