import { act, useState } from "react";
import type { ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { WorkingFolderPicker } from "./WorkingFolderPicker";
import { workingFolderPath, type WorkingFolderChoice } from "./workingFolder";

const mocks = vi.hoisted(() => ({ pickFolder: vi.fn(), browse: vi.fn() }));
vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => "local" }));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ dialogs: { pickFolder: mocks.pickFolder } }),
}));
vi.mock("../../state/filesystem", () => ({
  filesystemEnvironment: { browse: mocks.browse },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    isPending: false,
    isSuccess: true,
    error: null,
    data: { parentPath: "/remote/work", entries: [] },
  }),
}));
vi.mock("../ui/button", () => ({
  Button: (props: ComponentProps<"button">) => <button {...props} />,
}));
vi.mock("../ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));

let renderer: ReactTestRenderer;
function Fixture({
  environmentId = "local",
  mode = "existing",
}: {
  environmentId?: string;
  mode?: WorkingFolderChoice["mode"];
}) {
  const [value, onChange] = useState<WorkingFolderChoice>({
    mode,
    location: "~/Documents",
    name: "Project Y",
  });
  return (
    <>
      <WorkingFolderPicker
        environmentId={EnvironmentId.make(environmentId)}
        value={value}
        onChange={onChange}
      />
      <output>{workingFolderPath(value)}</output>
    </>
  );
}
async function mount(props: ComponentProps<typeof Fixture> = {}) {
  await act(() => {
    renderer = create(<Fixture {...props} />);
  });
}
async function click(text: string) {
  const button = renderer.root.findAllByType("button").find((node) => node.children.includes(text));
  expect(button).toBeDefined();
  await act(async () => {
    button!.props.onClick();
  });
}
function selectedPath() {
  return renderer.root.findByType("output").children.join("");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  vi.stubGlobal("window", { desktopBridge: { pickFolder: mocks.pickFolder } });
  mocks.pickFolder.mockResolvedValue("/Users/Hugo/My Projects");
});
afterEach(async () => {
  await act(() => renderer.unmount());
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("working folder selection", () => {
  it("uses the native Mac selection as the working folder without opening the in-app browser", async () => {
    await mount();
    await click("Browse folders");
    expect(mocks.pickFolder).toHaveBeenCalledWith({ initialPath: "~/Documents" });
    expect(selectedPath()).toBe("/Users/Hugo/My Projects");
    expect(mocks.browse).not.toHaveBeenCalled();
  });

  it("keeps the current folder when the native dialog is cancelled", async () => {
    mocks.pickFolder.mockResolvedValueOnce(null);
    await mount();
    await click("Browse folders");
    expect(selectedPath()).toBe("~/Documents");
    expect(mocks.browse).not.toHaveBeenCalled();
    await click("Browse folders");
    expect(selectedPath()).toBe("/Users/Hugo/My Projects");
  });

  it("uses the chosen parent for a new folder and keeps the entered folder name", async () => {
    await mount({ mode: "create" });
    await click("Browse folders");
    expect(selectedPath()).toBe("/Users/Hugo/My Projects/Project Y/");
  });

  it("keeps the draft on a native error and allows retrying", async () => {
    mocks.pickFolder.mockRejectedValueOnce(new Error("Dialog unavailable"));
    await mount();
    await click("Browse folders");
    expect(selectedPath()).toBe("~/Documents");
    expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("Try again");
    await click("Browse folders");
    expect(selectedPath()).toBe("/Users/Hugo/My Projects");
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  });

  it.each([
    ["remote", true, "MacIntel"],
    ["local", false, "MacIntel"],
    ["local", true, "Win32"],
  ] as const)(
    "browses the selected environment for %s, desktop=%s, platform=%s",
    async (environmentId, desktop, platform) => {
      vi.stubGlobal("window", desktop ? { desktopBridge: {} } : {});
      vi.stubGlobal("navigator", { platform });
      await mount({ environmentId });
      await click("Browse folders");
      expect(mocks.pickFolder).not.toHaveBeenCalled();
      expect(mocks.browse).toHaveBeenCalledWith({
        environmentId,
        input: { partialPath: "~/Documents/" },
      });
      await click("Use this location");
      expect(selectedPath()).toBe("/remote/work");
    },
  );
});
