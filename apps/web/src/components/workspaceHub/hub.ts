import type { EnvironmentId, HubKind, HubSaveInput, HubSummary } from "@t3tools/contracts";
import { randomUUID } from "../../lib/utils";

export function newHubItem(kind: HubKind, overrides: Partial<HubSaveInput> = {}): HubSaveInput {
  return {
    id: randomUUID(),
    kind,
    title: "",
    body: "",
    contacts: "",
    resources: [],
    clientIds: [],
    projectIds: [],
    workspaceIds: [],
    threadIds: [],
    chatIds: [],
    aiContext: false,
    relatedIds: [],
    tags: [],
    folder: "",
    pinned: kind === "project",
    archived: false,
    status: kind === "task" ? "todo" : "active",
    priority: "normal",
    dueDate: null,
    version: 0,
    ...overrides,
  };
}

export function belongsToClient(
  item: HubSummary,
  clientId: string,
  items: readonly HubSummary[],
): boolean {
  return (
    !clientId ||
    item.clientIds.includes(clientId) ||
    item.projectIds.some((id) =>
      items.some((project) => project.id === id && project.clientIds.includes(clientId)),
    )
  );
}

export function relatedHubItems(item: HubSummary, items: readonly HubSummary[]): HubSummary[] {
  return items.filter(
    (other) =>
      other.id !== item.id &&
      (item.relatedIds.includes(other.id) ||
        other.relatedIds.includes(item.id) ||
        item.projectIds.includes(other.id) ||
        other.projectIds.includes(item.id)),
  );
}

export type CaptureRequest = {
  body?: string;
  title?: string;
  environmentId?: EnvironmentId;
  threadId?: string;
  projectIds?: string[];
  clientIds?: string[];
  aiContext?: boolean;
};
export const CAPTURE_EVENT = "t3:quick-capture";
export function openQuickCapture(request: CaptureRequest = {}) {
  window.dispatchEvent(new CustomEvent<CaptureRequest>(CAPTURE_EVENT, { detail: request }));
}

export function downloadFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function safeFilename(title: string) {
  return (
    title
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/\p{Cc}/gu, "-")
      .slice(0, 120)
      .trim() || "untitled"
  );
}
