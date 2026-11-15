# Notes, projects and everyday tools

Open **Work** from the left navigation to keep a project's chats, notes, tasks
and time together. Clients hold your contacts and billing rates. **Notes** also provides a cross-project inbox.
Information is saved in the selected environment. These screens are available in
desktop and web; native mobile continues to handle chats and threads.

Use the search on **Work** to find clients, projects, chat titles, and saved note content. Open a client to see its projects, client-wide chats, notes, and default AI account. Open a project for its chats, notes, tasks, working folders, and recorded time. The arrows in the sidebar expand or collapse groups; names open them.

## Projects and working folders

A project describes your work, for example **HumanOS**. Its working folder contains
the files an agent uses, for example **sprintsync-board**. A project can use several
folders, and existing chats keep their original folders.

Choose **New project**, enter a name, then use **Add folder** to choose an existing
folder or **Create a new folder**. Browse to the parent location and enter the new folder's
name. The folder is created when you save. On a remote environment, this location
is on the computer running that environment. You can choose a folder later; T3
creates a managed folder when you start a chat without one.

The sidebar follows **Client → Project → Chats**. Clients and projects collapse
independently, and T3 remembers their state. Use **Clients** in the sidebar to create or rename clients; these are the same clients used for time tracking.
An hourly rate is optional.

In **Manage clients**, set **Default for other chats** to the AI account and model
you want for Personal projects, Free chats and clients without an override. Edit a
client to choose its own **AI account** and **Starting model**, or choose **Use
general default** to inherit. Accounts come from **Settings → Providers**, where
you can add and sign into multiple accounts for the same provider. Defaults are
saved on the selected computer and apply to new chats; existing chats keep their
account. Moving a project to another client changes the default for future chats.
If a selected account is unavailable, T3 asks you to fix or change it instead of
silently choosing another account. **Automatic** restores the usual chat defaults.

Use **New chat** beside a client for a general conversation without choosing a
project. These chats appear directly under the client, above its projects, and use
the client's default AI account or the general default. The New chat shortcut
keeps you in that client. Use **New project** beside the client to create a project
for it, then **New chat** beside a project for project work.

Client chats receive a short overview of that client's active projects and notes
linked to the client with **Share with AI** enabled. Use **AI context** above
the composer to preview this information and link specific projects for their
notes and folders. Linking or unlinking projects keeps the chat under its client.
Other chat histories are not included automatically. Archiving a client preserves
its chats; restore the client in **Manage clients** before starting new ones.

Drag a project's name onto another client to move it;
collapsed clients accept drops too. Drop onto **Personal projects** to remove its
client. You can also change **Project settings → Client** and save. Moving a project
keeps its chats, notes and working folders together and leaves past time entries
and billing rates unchanged. Older projects with several client links appear once,
under their first client.

Click a project's name for chats, notes, folders, tasks and time. Normal chat
creation and its keyboard shortcuts keep the current project. You can select
Claude Code, Codex or OpenCode in the composer.

**Free chats** holds conversations outside projects. Its **+**, or **New free chat**
in the command palette, starts one without asking you to create a project or pick
a folder. Use **AI context → Add chat** later to place it in a project. Unlink it to
return it to Free chats. Free chats do not receive a project's notes until linked;
other free chats remain independent. On multiple environments, the sidebar's
**Computer** selection chooses where new free chats and clients are saved.

In **Project settings**, add as many folders as you need. The first folder is where
new chats start; **Use first** changes that default. Existing chats keep their own
working folders. Those folders stay linked while the project contains their chats;
other folder links can be removed without moving or deleting files.

Existing folder-based projects appear in this same list. Adding their folders to
another project groups their chats there. Older projects that contain chats also
recognize those chats' folders automatically.

Use **AI context → Add chat** to share a chat with another project. Each chat appears
once in the sidebar and remains accessible from every linked project's page.
**Unlink chat** removes membership without deleting history. Archived projects can
be restored from **Work → Archived projects → Project settings**; archived chats
remain available in Settings.

## Give the AI shared project notes

A project's brief is included automatically in its chats. Use **Notes → New note**
in the project, or enable **Share with AI** when editing an existing note. Link
that note to one or more projects. The latest saved content is included each time
you send a message, including when continuing the chat from mobile.

Use the **AI context** control above the composer to preview the saved context and
manage the chat's projects. Notes remain one shared copy across projects. Unmarked or
archived notes, other chat histories and contacts are not included automatically.
The AI also receives the linked folder locations and a small overview of up to four
folders: top-level file names and short README excerpts. It reads other files as
needed under the provider’s normal permissions; this is not a full index of every
file. The context preview shows the current content. Existing **Chat references** remain reference links; they do not
grant a chat access to a hub's notes.

Context is sent to the provider selected for that chat. Disabling a note, unlinking
a chat, or archiving a project stops future inclusion; material already sent remains in
the conversation. Very long context is shortened, with a notice in the preview.

## Capture and find information

Use **Quick capture** or **Command/Ctrl + Shift + J** while T3 is focused. Capture a
title and note, then save. Capture starts in the client or project you are viewing,
including when you are in one of its chats. Check **Save to** and use **Change** to
choose different or additional projects. Captures outside a client or project go to
**Inbox**. An assistant response
also has **Save note**, which keeps a link to its source chat. Notes support Markdown,
checklists, collections, tags, pinning and full-text search. Use **Preview** to read the
formatted text. Choose **Edit** to change a note or check off its Markdown checklist.

Changes are saved when you choose **Save**. Closing an edited draft asks before
discarding it. If another device has edited the same item, your save is rejected
without discarding your draft. Export that draft if needed, then reopen the saved
item to reconcile the changes.

## Connect work across clients and projects

Use **Clients** in the sidebar or **Clients** in the calendar to manage clients
and rates. A project can represent any kind of work; it does not need a code folder.
Add its background, then connect relevant folders, notes and chats.

In **Edit → Organize**, select any number of projects or clients. A shared
note or task appears in each linked project, with one saved version. Editing it
updates the information everywhere it is linked. Removing a link does not delete
the item. Related notes and tasks show links in both directions.

Create tasks with a status, priority and due date. Use **Today & overdue**,
**Upcoming** or **Waiting** to focus your list. **Create linked task** keeps the
original note and adds a task referring back to it. Completed tasks can be reopened;
archived items can be found under **Archived** and restored.

For a one-off conversation outside a project, **Use this in a new chat → Prepare AI chat** puts an item's saved
content into a draft in a selected working folder. Review before sending.

## Connect time and earnings

Assign a project when editing a calendar entry. Each entry belongs to one billing client and optionally one
project, even when the underlying task is shared. This prevents shared work from
being counted twice. Project details show the current month's hours and value;
the calendar's **Reports** also supports project filtering for weeks, months and
custom dates. Existing entries remain unassigned until you choose a project.

## Export your information

**Export** downloads a ZIP containing readable Markdown files and a JSON copy of
projects, notes, tasks, links and client details, including archived items. An
individual item or unsaved draft can also be exported as Markdown. Calendar entries
are exported separately from **Reports**. These are manual exports, not automatic
backups of T3's database, chats or linked files.

## Everyday toolbox

Open **Tools** and choose a tool. Processing happens on the device displaying T3;
selected files are not uploaded to an environment or AI provider. Download the
result when ready. Original files remain unchanged.

- **Images:** resize JPEG, PNG and WebP files while keeping their proportions; choose
  output format and compression quality. JPEG replaces transparency with white.
- **PDF pages:** order files, select page ranges, merge them, or split the first PDF
  into separate pages in a ZIP. Flatten interactive forms first. Digital signatures
  are not preserved.
- **Extract text:** extract existing PDF text from selected pages. Scanned images
  require OCR, which is not included.
- **CSV cleanup:** trim whitespace, remove empty or duplicate rows, preview the
  result, and download it. Select the delimiter used by the source. Formula-like
  values are exported as spreadsheet text by default; disable that option to retain
  them verbatim.
- **Batch rename:** preview prefix, replacement, case and numbering changes, then
  download renamed copies in a ZIP. Name collisions must be resolved first.
