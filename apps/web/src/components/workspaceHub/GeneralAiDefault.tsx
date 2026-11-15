import { useState } from "react";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEnvironments } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import { AiAccountPicker } from "./AiAccountPicker";
import { Button } from "../ui/button";

export function GeneralAiDefault({ environmentId }: { environmentId: EnvironmentId }) {
  const { environments } = useEnvironments();
  const config = environments.find((env) => env.environmentId === environmentId)?.serverConfig;
  const [draft, setDraft] = useState<{ value: ModelSelection | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  return (
    <form
      className="time-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft || busy) return;
        setBusy(true);
        setMessage(null);
        void update({ environmentId, input: { patch: { defaultModelSelection: draft.value } } })
          .then((result) => {
            if (result._tag !== "Success") throw squashAtomCommandFailure(result);
            setDraft(null);
            setMessage({ text: "Default saved for new chats.", error: false });
          })
          .catch((cause: unknown) =>
            setMessage({
              text: cause instanceof Error ? cause.message : "Could not save the default.",
              error: true,
            }),
          )
          .finally(() => setBusy(false));
      }}
    >
      <h3 className="time-form-title">Default for other chats</h3>
      <p className="time-muted">
        Used for clients that inherit the default, Personal projects and Free chats. Existing chats
        keep their account. Add or sign into accounts in Settings → Providers.
      </p>
      <AiAccountPicker
        environmentId={environmentId}
        value={draft ? draft.value : (config?.settings.defaultModelSelection ?? null)}
        onChange={(value) => {
          setDraft({ value });
          setMessage(null);
        }}
        inheritLabel="Automatic"
        disabled={busy}
      />
      <div className="time-actions time-actions-end">
        <Button type="submit" disabled={busy || !draft || !config}>
          {busy ? "Saving…" : "Save default"}
        </Button>
      </div>
      {message && (
        <p
          className={message.error ? "time-error" : "time-muted"}
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
