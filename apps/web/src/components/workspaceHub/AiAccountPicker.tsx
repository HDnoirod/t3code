import { useEnvironmentProviders } from "../../state/environments";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ModelSelection,
} from "@t3tools/contracts";
import { useEnvironments } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import {
  deriveProviderInstanceEntries,
  applyProviderInstanceSettings,
  getDefaultProviderInstanceModel,
} from "../../providerInstances";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { mergeEnvironmentSettings, useClientSettings } from "../../hooks/useSettings";

export function AiAccountPicker({
  environmentId,
  value,
  onChange,
  inheritLabel,
  disabled = false,
}: {
  environmentId: EnvironmentId;
  value: ModelSelection | null;
  onChange: (value: ModelSelection | null) => void;
  inheritLabel: string;
  disabled?: boolean;
}) {
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const config = environments.find((env) => env.environmentId === environmentId)?.serverConfig;
  const providers = providersByEnvironment.get(environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const clientSettings = useClientSettings();
  const settings = mergeEnvironmentSettings(
    config?.settings ?? DEFAULT_SERVER_SETTINGS,
    clientSettings,
  );
  const entries = applyProviderInstanceSettings(
    deriveProviderInstanceEntries(providers),
    settings,
    null,
  );
  const models = getCustomModelOptionsByInstance(
    settings,
    providers,
    value?.instanceId,
    value?.model,
  );
  const selected = entries.find((entry) => entry.instanceId === value?.instanceId);
  return (
    <div className="time-pricing-fields">
      <label className="time-field">
        AI account
        <select
          className="time-select"
          value={value?.instanceId ?? ""}
          disabled={disabled || !config}
          onChange={(event) => {
            if (!event.target.value) {
              onChange(null);
              return;
            }
            const entry = entries.find((entry) => entry.instanceId === event.target.value);
            if (!entry) return;
            const model =
              getDefaultProviderInstanceModel(providers, entry.instanceId) ??
              models.get(entry.instanceId)?.find((option) => !option.isUnavailable)?.slug;
            if (model) onChange({ instanceId: entry.instanceId, model });
          }}
        >
          <option value="">{inheritLabel}</option>
          {value && !selected && (
            <option value={value.instanceId} disabled>
              {value.instanceId} (unavailable)
            </option>
          )}
          {entries.map((entry) => (
            <option
              key={entry.instanceId}
              value={entry.instanceId}
              disabled={
                !entry.enabled || !entry.isAvailable || !models.get(entry.instanceId)?.length
              }
            >
              {entry.displayName}
              {!entry.enabled || !entry.isAvailable ? " (unavailable)" : ""}
            </option>
          ))}
        </select>
      </label>
      {value && (
        <label className="time-field">
          Starting model
          <select
            className="time-select"
            value={value.model}
            disabled={disabled || !selected?.enabled || !selected.isAvailable}
            onChange={(event) =>
              onChange({ instanceId: value.instanceId, model: event.target.value })
            }
          >
            {!models.get(value.instanceId)?.some((option) => option.slug === value.model) && (
              <option value={value.model} disabled>
                {value.model} (unavailable)
              </option>
            )}
            {models.get(value.instanceId)?.map((option) => (
              <option key={option.slug} value={option.slug} disabled={option.isUnavailable}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
