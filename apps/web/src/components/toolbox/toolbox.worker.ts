import { runToolboxJob, type ToolboxJob, type ToolboxReply } from "./jobs";

globalThis.addEventListener("message", async (event: MessageEvent<ToolboxJob>) => {
  let reply: ToolboxReply;
  try {
    reply = { ok: true, result: await runToolboxJob(event.data) };
  } catch (cause) {
    reply = {
      ok: false,
      error: cause instanceof Error ? cause.message : "Could not process these files.",
    };
  }
  globalThis.postMessage(reply, { transfer: [] });
});
