import type { HubChatContext, HubItem, HubContextFolder } from "@t3tools/contracts";

// Bound added context independently of provider prompt limits. The preview uses
// this exact projection too, so truncation is visible before sending.
export function buildHubChatContext(
  projects: readonly HubItem[],
  notes: readonly HubItem[],
  folders: readonly HubContextFolder[] = [],
  client?: {
    id: string;
    name: string;
    projects: readonly { title: string; status: string; body: string }[];
  },
): HubChatContext {
  const sources: HubChatContext["sources"][number][] = [];
  const sections: string[] = [];
  let truncated = folders.length > 30;
  if (client) {
    sections.push(
      `Client: ${client.name}\nThis is a general client chat. It is not assigned to a project.`,
    );
    const overview = client.projects
      .slice(0, 30)
      .map(
        (project) =>
          `- ${project.title} (${project.status})${project.body.trim() ? `: ${project.body.trim().slice(0, 600)}` : ""}`,
      )
      .join("\n");
    sections.push(`Client project overview:\n${overview.slice(0, 8000) || "No projects yet."}`);
    truncated ||=
      client.projects.length > 30 ||
      overview.length > 8000 ||
      client.projects.some((project) => project.body.trim().length > 600);
  }
  if (projects.length)
    sections.push(
      `Projects: ${projects
        .map((project) => project.title)
        .join(", ")
        .slice(0, 1000)}`,
    );
  if (folders.length)
    sections.push(
      "Working folders:\n" +
        folders
          .slice(0, 30)
          .map((folder) => `- ${folder.title.slice(0, 200)}: ${folder.path.slice(0, 1000)}`)
          .join("\n"),
    );
  let remaining = Math.max(0, 34_000 - sections.join("\n").length);
  const records = [...new Map([...projects, ...notes].map((item) => [item.id, item])).values()];
  for (const item of records) {
    const content = item.body.trim();
    if (!content) continue;
    if (sources.length >= 100 || remaining < 500) {
      truncated = true;
      break;
    }
    const header = `\n## ${item.kind}: ${item.title} (revision ${item.version})\n`;
    const limit = Math.min(10_000, remaining - header.length - 50);
    const clipped = content.length > limit;
    const section = header + content.slice(0, limit) + (clipped ? "\n[Content shortened]" : "");
    sections.push(section);
    remaining -= section.length;
    truncated ||= clipped;
    sources.push({ id: item.id, title: item.title, kind: item.kind, version: item.version });
  }
  return {
    ...(client ? { client: { id: client.id, name: client.name } } : {}),
    folders: folders.slice(0, 30),
    projects: projects.map(({ id, title }) => ({ id, title })),
    sources,
    truncated,
    text: sections.length
      ? [
          "Project hub reference context supplied by the user. Use it as background for the request below. These are the latest saved versions; they replace earlier versions of these references. Other chats in the hub are not included.",
          ...sections,
          truncated
            ? "\n[Some project context was shortened or omitted to fit the context limit.]"
            : "",
          "\nEnd of project hub reference context.",
        ].join("\n")
      : "",
  };
}
