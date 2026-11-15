import { describe, expect, it } from "vite-plus/test";
import { workingFolderPath } from "./workingFolder";

describe("new project folder location", () => {
  it("creates inside the selected parent without dropping its final directory", () => {
    expect(
      workingFolderPath({ mode: "create", location: "/Users/Hugo/My Projects", name: "HumanOS" }),
    ).toBe("/Users/Hugo/My Projects/HumanOS/");
    expect(workingFolderPath({ mode: "create", location: "~/Documents/", name: " HumanOS " })).toBe(
      "~/Documents/HumanOS/",
    );
  });
  it("keeps remote Windows paths and existing folders intact", () => {
    expect(workingFolderPath({ mode: "create", location: "C:\\Projects", name: "HumanOS" })).toBe(
      "C:\\Projects\\HumanOS\\",
    );
    expect(
      workingFolderPath({
        mode: "existing",
        location: " /Users/Hugo/sprintsync-board ",
        name: "ignored",
      }),
    ).toBe("/Users/Hugo/sprintsync-board");
  });
});
