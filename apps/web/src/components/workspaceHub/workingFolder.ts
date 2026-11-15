import { appendBrowsePathSegment, ensureBrowseDirectoryPath } from "../../lib/projectPaths";

export interface WorkingFolderChoice {
  mode: "linked" | "existing" | "create";
  location: string;
  name: string;
}

export function workingFolderPath(choice: WorkingFolderChoice) {
  return choice.mode === "create"
    ? appendBrowsePathSegment(ensureBrowseDirectoryPath(choice.location.trim()), choice.name.trim())
    : choice.location.trim();
}
