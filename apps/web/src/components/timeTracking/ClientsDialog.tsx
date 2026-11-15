import { randomUUID } from "../../lib/utils";
import {
  TimeTrackingCurrency,
  type TimeTrackingClient,
  type TimeTrackingMutation,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import type { SaveTimeChange } from "./TimeEntryDialog";
import { formatMoney, parseRate, rateText } from "./report";
import { AiAccountPicker } from "../workspaceHub/AiAccountPicker";
import { GeneralAiDefault } from "../workspaceHub/GeneralAiDefault";
import { useEnvironments } from "../../state/environments";
import { deriveProviderInstanceEntries } from "../../providerInstances";

type ClientDraft = Extract<TimeTrackingMutation, { type: "client.save" }>;
const COLORS = ["#6366f1", "#0d9488", "#d97706", "#db2777", "#2563eb", "#7c3aed"];
const newClient = (): ClientDraft => ({
  type: "client.save",
  id: randomUUID(),
  name: "",
  color: COLORS[0]!,
  archived: false,
  version: 0,
  hourlyRateCents: null,
  currency: "CAD",
  defaultModelSelection: null,
});

export function ClientsDialog({
  environmentId,
  clients,
  onClose,
  onSave,
  initialClientId,
}: {
  environmentId: EnvironmentId;
  clients: ReadonlyArray<TimeTrackingClient>;
  onClose: () => void;
  onSave: SaveTimeChange;
  initialClientId?: string | undefined;
}) {
  const { environments } = useEnvironments();
  const config = environments.find((env) => env.environmentId === environmentId)?.serverConfig;
  const accounts = deriveProviderInstanceEntries(config?.providers ?? []);
  const initialClient = clients.find((client) => client.id === initialClientId);
  const [draft, setDraft] = useState<ClientDraft>(() =>
    initialClient ? { ...initialClient, type: "client.save" } : newClient(),
  );
  const [rate, setRate] = useState(() =>
    initialClient ? rateText(initialClient.hourlyRateCents) : "",
  );
  const [applyUnrated, setApplyUnrated] = useState(false);
  const reset = () => {
    setDraft(newClient());
    setRate("");
    setApplyUnrated(false);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (change: ClientDraft) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const failure = await onSave(change);
    setBusy(false);
    if (failure) setError(failure);
    else if (initialClientId) onClose();
    else reset();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup className="overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialClient ? `${initialClient.name} settings` : "Clients"}</DialogTitle>
          <DialogDescription>
            Organize projects by client. Add an hourly rate when you want to track earnings.
          </DialogDescription>
        </DialogHeader>
        {!initialClientId && <GeneralAiDefault key={environmentId} environmentId={environmentId} />}
        {!initialClientId && (
          <div className="time-clients">
            {clients.length === 0 && (
              <p className="time-muted">
                Add your first client to organize projects and track time.
              </p>
            )}
            {clients.map((client) => (
              <div className="time-client-row" key={client.id}>
                <span className="time-client-dot" style={{ backgroundColor: client.color }} />
                <div className="time-client-name">
                  <strong>{client.name}</strong>
                  <span>
                    {client.hourlyRateCents === null
                      ? "No hourly rate"
                      : `${formatMoney(client.hourlyRateCents, client.currency)}/h`}
                  </span>
                  {client.archived && <span>Archived</span>}
                  <span>
                    AI:{" "}
                    {client.defaultModelSelection
                      ? (accounts.find(
                          (account) =>
                            account.instanceId === client.defaultModelSelection?.instanceId,
                        )?.displayName ?? client.defaultModelSelection.instanceId)
                      : "General default"}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setDraft({ ...client, type: "client.save" });
                    setRate(rateText(client.hourlyRateCents));
                    setApplyUnrated(false);
                    setError(null);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void save({ ...client, type: "client.save", archived: !client.archived })
                  }
                >
                  {client.archived ? "Restore" : "Archive"}
                </Button>
              </div>
            ))}
          </div>
        )}
        <form
          className="time-form"
          onSubmit={(event) => {
            event.preventDefault();
            const hourlyRateCents = rate.trim() ? parseRate(rate) : null;
            if ((rate.trim() || applyUnrated) && hourlyRateCents === null) {
              setError("Enter a rate from 0 to 1,000,000 with up to two decimal places.");
              return;
            }
            void save({
              ...draft,
              name: draft.name.trim(),
              hourlyRateCents,
              applyToUnratedEntries: applyUnrated,
            });
          }}
        >
          <h3 className="time-form-title">{draft.version ? "Edit client" : "New client"}</h3>
          <label className="time-field">
            Client name
            <Input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="e.g. Acme Studio"
              maxLength={100}
              required
              disabled={busy}
            />
          </label>
          <AiAccountPicker
            environmentId={environmentId}
            value={draft.defaultModelSelection ?? null}
            onChange={(defaultModelSelection) => setDraft({ ...draft, defaultModelSelection })}
            inheritLabel="Use general default"
            disabled={busy || config?.hubChatDefaults !== true}
          />
          {config && !config.hubChatDefaults && (
            <p className="time-muted">
              Update T3 on the selected computer to set client-specific AI accounts.
            </p>
          )}
          <div className="time-pricing-fields">
            <label className="time-field">
              Hourly rate (optional)
              <Input
                type="number"
                value={rate}
                min={0}
                max={1000000}
                step="0.01"
                placeholder="e.g. 100.00"
                disabled={busy}
                onChange={(event) => setRate(event.target.value)}
              />
            </label>
            <label className="time-field">
              Currency
              <select
                className="time-select"
                value={draft.currency ?? "CAD"}
                disabled={busy}
                onChange={(event) => {
                  const currency = TimeTrackingCurrency.literals.find(
                    (value) => value === event.target.value,
                  );
                  if (currency) setDraft({ ...draft, currency });
                }}
              >
                {TimeTrackingCurrency.literals.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>
          </div>
          {draft.version > 0 && (
            <label className="time-check-label">
              <input
                type="checkbox"
                checked={applyUnrated}
                disabled={busy}
                onChange={(event) => setApplyUnrated(event.target.checked)}
              />
              Apply this rate to this client's existing entries without a rate
            </label>
          )}
          <fieldset className="time-colors">
            <legend>Calendar color</legend>
            {COLORS.map((color) => (
              <label key={color}>
                <input
                  type="radio"
                  name="client-color"
                  aria-label={`Color ${color}`}
                  value={color}
                  checked={draft.color === color}
                  disabled={busy}
                  onChange={() => setDraft({ ...draft, color })}
                />
                <span style={{ backgroundColor: color }} />
              </label>
            ))}
          </fieldset>
          {error && (
            <p className="time-error" role="alert">
              {error}
            </p>
          )}
          <div className="time-actions time-actions-end">
            {draft.version > 0 && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (initialClientId) onClose();
                  else reset();
                  setError(null);
                }}
              >
                Cancel edit
              </Button>
            )}
            <Button type="submit" disabled={busy || !draft.name.trim()}>
              {busy ? "Saving…" : draft.version ? "Save client" : "Add client"}
            </Button>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
