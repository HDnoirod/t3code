import {
  TimeTrackingCurrency,
  type TimeTrackingClient,
  type TimeTrackingMutation,
} from "@t3tools/contracts";
import { useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { clockTime, formatHours } from "./calendar";
import { parseRate, rateText } from "./report";

export type EntryDraft = Extract<TimeTrackingMutation, { type: "entry.save" }>;
export type SaveTimeChange = (change: TimeTrackingMutation) => Promise<string | null>;

const EMPTY_PROJECTS: ReadonlyArray<{ id: string; title: string }> = [];

export function TimeEntryDialog({
  draft,
  clients,
  projects = EMPTY_PROJECTS,
  onClose,
  onSave,
}: {
  draft: EntryDraft;
  clients: ReadonlyArray<TimeTrackingClient>;
  projects?: ReadonlyArray<{ id: string; title: string }>;
  onClose: () => void;
  onSave: SaveTimeChange;
}) {
  const [projectId, setProjectId] = useState(draft.projectId ?? "");
  const [clientId, setClientId] = useState(draft.clientId);
  const [date, setDate] = useState(draft.date);
  const [start, setStart] = useState(clockTime(draft.startMinute));
  const [hours, setHours] = useState(String((draft.endMinute - draft.startMinute) / 60));
  const [task, setTask] = useState(draft.task);
  const [notes, setNotes] = useState(draft.notes);
  const [rate, setRate] = useState(rateText(draft.hourlyRateCents));
  const [currency, setCurrency] = useState(draft.currency ?? "CAD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const finish = async (change: TimeTrackingMutation) => {
    setBusy(true);
    setError(null);
    const failure = await onSave(change);
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
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
          <DialogTitle>{draft.version ? "Edit time" : "Add time"}</DialogTitle>
          <DialogDescription>Record the time you spent working for a client.</DialogDescription>
        </DialogHeader>
        <form
          className="time-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const [hour, minute] = start.split(":").map(Number);
            const startMinute = (hour ?? 0) * 60 + (minute ?? 0);
            const duration = Number(hours) * 60;
            const hourlyRateCents = rate.trim() === "" ? null : parseRate(rate);
            if (rate.trim() !== "" && hourlyRateCents === null) {
              setError("Enter a valid hourly rate with up to two decimal places.");
              return;
            }
            if (!clientId || !date || !start || !task.trim()) {
              setError("Choose a client, date, start time, and task.");
              return;
            }
            if (!Number.isInteger(duration) || duration <= 0 || startMinute + duration > 1440) {
              setError(
                "Enter a positive duration that ends by midnight. Split overnight work into two entries.",
              );
              return;
            }
            void finish({
              ...draft,
              clientId,
              projectId: projectId || null,
              date,
              startMinute,
              endMinute: startMinute + duration,
              task: task.trim(),
              notes,
              hourlyRateCents,
              currency,
            });
          }}
        >
          <label className="time-field">
            Client
            <select
              className="time-select"
              value={clientId}
              onChange={(event) => {
                const id = event.target.value;
                const pricing =
                  id === draft.clientId ? draft : clients.find((client) => client.id === id);
                setClientId(id);
                setRate(rateText(pricing?.hourlyRateCents));
                setCurrency(pricing?.currency ?? "CAD");
              }}
              required
              disabled={busy}
            >
              <option value="" disabled>
                Select a client
              </option>
              {clients
                .filter((client) => !client.archived || client.id === draft.clientId)
                .map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                    {client.archived ? " (archived)" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label className="time-field">
            Project <span className="time-muted">Optional · one allocation per time entry</span>
            <select
              className="time-select"
              value={projectId}
              disabled={busy}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">No project</option>
              {projectId && !projects.some((project) => project.id === projectId) && (
                <option value={projectId}>Linked project</option>
              )}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
          <label className="time-field">
            Task
            <Input
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="What did you work on?"
              maxLength={160}
              required
              disabled={busy}
              autoFocus
            />
          </label>
          <div className="time-form-row">
            <label className="time-field">
              Date
              <Input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label className="time-field">
              Start
              <Input
                type="time"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label className="time-field">
              Hours
              <Input
                type="number"
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                min={0.25}
                max={24}
                step={0.25}
                required
                disabled={busy}
              />
            </label>
          </div>
          <div className="time-pricing-fields">
            <label className="time-field">
              Hourly rate for this entry
              <Input
                type="number"
                value={rate}
                min={0}
                max={1000000}
                step="0.01"
                placeholder="Not set"
                disabled={busy}
                onChange={(event) => setRate(event.target.value)}
              />
            </label>
            <label className="time-field">
              Currency
              <select
                className="time-select"
                value={currency}
                disabled={busy}
                onChange={(event) => {
                  const value = TimeTrackingCurrency.literals.find(
                    (item) => item === event.target.value,
                  );
                  if (value) setCurrency(value);
                }}
              >
                {TimeTrackingCurrency.literals.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="time-muted">
            Leave the rate blank to mark this entry as unpriced. A zero rate records unpaid time.
          </p>
          <label className="time-field">
            Notes <span className="time-muted">Optional</span>
            <textarea
              className="time-textarea"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={4000}
              rows={3}
              disabled={busy}
              placeholder="Details to remember for your client"
            />
          </label>
          {error && (
            <p className="time-error" role="alert">
              {error}
            </p>
          )}
          {confirmDelete && (
            <div className="time-delete-confirm" role="alert">
              <p>
                Delete this {formatHours(draft.endMinute - draft.startMinute)} entry? This cannot be
                undone.
              </p>
              <div className="time-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep entry
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    void finish({ type: "entry.delete", id: draft.id, version: draft.version })
                  }
                >
                  Delete entry
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            {draft.version > 0 && !confirmDelete && (
              <Button
                type="button"
                variant="ghost-destructive"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save time"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
