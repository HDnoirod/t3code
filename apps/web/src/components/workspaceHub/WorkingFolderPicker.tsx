import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironmentQuery } from "../../state/query";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { filesystemEnvironment } from "../../state/filesystem";
import { ensureLocalApi } from "../../localApi";
import { isMacPlatform } from "../../lib/utils";
import { ensureBrowseDirectoryPath, getBrowseParentPath } from "../../lib/projectPaths";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

import { workingFolderPath, type WorkingFolderChoice } from "./workingFolder";

export function WorkingFolderPicker({
  environmentId,
  value,
  onChange,
}: {
  environmentId: EnvironmentId;
  value: WorkingFolderChoice;
  onChange: (value: WorkingFolderChoice) => void;
}) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const browse = useEnvironmentQuery(
    browsePath === null
      ? null
      : filesystemEnvironment.browse({
          environmentId,
          input: { partialPath: ensureBrowseDirectoryPath(browsePath) },
        }),
  );
  const openPicker = async () => {
    if (picking) return;
    setError(null);
    // The Mac's native dialog only returns paths for its own local environment.
    if (
      typeof window === "undefined" ||
      !window.desktopBridge ||
      !isMacPlatform(navigator.platform) ||
      environmentId !== primaryEnvironmentId
    ) {
      setBrowsePath(value.location.trim() || "~/");
      return;
    }
    setPicking(true);
    try {
      const initialPath = value.location.trim();
      const location = await ensureLocalApi().dialogs.pickFolder(
        initialPath ? { initialPath } : undefined,
      );
      if (location) onChange({ ...value, location });
    } catch {
      setError("Could not open the folder picker. Try again or enter the folder path.");
    } finally {
      setPicking(false);
    }
  };
  return (
    <div className="hub-form-grid">
      <label className="hub-field">
        Working folder
        <select
          className="hub-select"
          value={value.mode}
          onChange={(event) => {
            const mode = event.target.value;
            if (mode === "linked" || mode === "existing" || mode === "create")
              onChange({ ...value, mode });
            setBrowsePath(null);
            setError(null);
          }}
        >
          <option value="linked">Use linked folders / choose later</option>
          <option value="existing">Choose an existing folder</option>
          <option value="create">Create a new folder</option>
        </select>
      </label>
      {value.mode !== "linked" && (
        <>
          <label className="hub-field">
            {value.mode === "create" ? "Create inside" : "Folder path"}
            <Input
              required
              maxLength={500}
              placeholder="~/Documents/Projects"
              value={value.location}
              onChange={(event) => onChange({ ...value, location: event.target.value })}
            />
          </label>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={picking}
              onClick={() => void openPicker()}
            >
              {picking ? "Choosing folder…" : "Browse folders"}
            </Button>
          </div>
          {error && (
            <p className="hub-error" role="alert">
              {error}
            </p>
          )}
          {browsePath !== null && (
            <div className="hub-folder-browser">
              <label className="hub-field">
                Browse location
                <Input value={browsePath} onChange={(event) => setBrowsePath(event.target.value)} />
              </label>
              {browse.error && (
                <p className="hub-error" role="alert">
                  {browse.error}
                </p>
              )}
              {browse.isPending && <p className="hub-muted">Loading folders…</p>}
              <div className="hub-folder-choices">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setBrowsePath(
                      getBrowseParentPath(ensureBrowseDirectoryPath(browsePath)) ?? browsePath,
                    )
                  }
                >
                  ↑ Parent folder
                </Button>
                {browse.data?.entries.map((entry) => (
                  <Button
                    key={entry.fullPath}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setBrowsePath(entry.fullPath)}
                  >
                    {entry.name}
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                disabled={browse.isPending || !browse.isSuccess}
                onClick={() => {
                  onChange({ ...value, location: browse.data?.parentPath ?? browsePath });
                  setBrowsePath(null);
                }}
              >
                Use this location
              </Button>
            </div>
          )}
          {value.mode === "create" && (
            <label className="hub-field">
              New folder name
              <Input
                required
                maxLength={100}
                value={value.name}
                placeholder="humanos"
                pattern="[^/\\\\]+"
                onChange={(event) => onChange({ ...value, name: event.target.value })}
              />
            </label>
          )}
          <p className="hub-muted">
            {value.mode === "create" ? "Created when you save" : "Used when you save"}:{" "}
            {workingFolderPath(value) || "Choose a location"}. This folder is on the computer
            running the selected environment.
          </p>
        </>
      )}
    </div>
  );
}
