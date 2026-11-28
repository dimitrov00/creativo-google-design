# Rich text for programs and posts (2026-11-27)

> **Status: DECIDED by Claude under the owner's standing delegation
> (2026-10-26), awaiting the owner's read. Steps 1–4 built for roles
> (2026-11-28); courses and events are not.** The owner asked on
> 2026-11-27 for a role's page to hold a real description — headings, lists,
> pictures — written by staff in a rich text editor, and for the same thing
> to carry blog posts later; and asked whether Firebase can hold it or
> whether it must be files.

## The problem

A role, a course and an event carry one short `summary`/`description` per
language. That is a listing line, not a job description. iSTYLE's careers
page is the model the owner pointed at: a role opens on a picture, then
sections — a summary with facts, «Job scope», requirements — as headings
and bulleted lists. Staff must be able to write that without a developer,
and attach pictures.

## Decisions

| #   | Question                      | Decision                                                                                                                                                                                                                        |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | What is stored?               | **Markdown**, a small fixed subset: headings (two levels), paragraphs, bold, italic, links, bulleted and numbered lists, quotes, pictures. One string per language (`LocalizedText`).                                           |
| 2   | Where does the text live?     | **In Firestore**, in a sibling document: `positionBodies/{id}`, `courseBodies/{id}`, `eventBodies/{id}`, later `postBodies/{id}` — `{ body: LocalizedText }`. Not in the listing document, not in Storage.                      |
| 3   | Where do pictures live?       | **In Cloud Storage**, under `media/programs/{programId}/{imageId}.webp`, never inside the text. The Markdown names a picture by its id; the page turns the id into an address.                                                  |
| 4   | How does a picture get there? | Through the hand-off the barber photo already uses: the browser uploads to `pending/{userId}/…`, a callable checks it (type, size, dimensions), re-encodes it and copies it into `media/`. Staff never write `media/` directly. |
| 5   | What draws it?                | A pure system parses the Markdown into a **flat list of blocks**; a new design-system element, `ui-rich-text`, draws the blocks with ordinary elements. No `innerHTML` anywhere.                                                |
| 6   | What do staff type in?        | **Tiptap** (ProseMirror), loaded only when the editor opens, with a toolbar for exactly the subset in decision 1. It reads and writes Markdown.                                                                                 |
| 7   | What about pasting from Word? | Pasted content comes in as **plain text**. Formatting is applied with the toolbar.                                                                                                                                              |
| 8   | How big may it be?            | 20 000 characters per language and 12 pictures per body, held by the rules and the callable. A picture is at most 2 400 px on its long side after re-encoding.                                                                  |

## Why

**Firestore can hold it.** A document may be 1 MiB. A long job description
is about 5 kB; a long blog post about 30 kB. Text is nowhere near the
limit, and one small read is cheaper and simpler than a Storage download
with its own caching and rules. What Firestore must not hold is pictures:
a base64 picture is a megabyte of document read on every view, billed and
slow. So text goes in Firestore and pictures in Storage — the split every
field of this app already follows.

**A sibling document, not a field.** The lists (`/careers`, the admin's
list, and one day the blog index) read every item. A body inside the
listing document would be downloaded by every list view to print one line.
A sibling document is read once, when a role is opened. It also keeps the
listing documents one flat shape (Law 5) and gives posts the same home
without a redesign.

**Markdown, not HTML.** Stored HTML has to be sanitised on every render,
and this app's security header forbids writing HTML strings into the page
(`require-trusted-types-for 'script'`). Markdown is plain text: nothing in
it can run.

**Markdown, not the editor's own JSON.** ProseMirror's document is a deep
tree of maps. It would be a nested, vendor-shaped blob in a database that
is otherwise flat, unreadable in the console, and tied to one editor.
Markdown is one string, readable as stored, diffable, and any editor can
replace Tiptap later without touching a stored document.

**A parser of our own, small.** The subset is fixed and small, so the
parser is a pure function with a spec (Law 3): Markdown in, a flat array of
blocks out — `{ blockKind: 'HEADING', level, spans }`, `{ blockKind:
'LIST', ordered, items }`, `{ blockKind: 'IMAGE', imageId, alt }`. Anything
outside the subset is printed as the text it is. No Markdown library is
added to the public pages.

**Tiptap for staff.** Barbershop staff should not learn Markdown. Tiptap
is the maintained ProseMirror kit with a Markdown extension; it is about
100 kB gzipped and is loaded only in `/admin`, so no public route pays for
it. The alternative — a text box with formatting buttons and a preview —
costs nothing and was rejected for that reason: it shows asterisks.

**Plain-text paste.** Parsing pasted HTML goes through `DOMParser`, which
the security header also guards. Allowing it means adding a named policy
to the header for the editor's sake. Plain-text paste avoids that and
keeps Word's styling out of the shop's pages.

## What it does not do

- No tables, no embedded video, no text colour or font size. The page's
  look stays the design system's.
- No drafts or history. A save replaces the body.
- No per-picture captions beyond the alt text.

## How it is built

1. **The model**: the block types and the parser system with its spec; the
   `…Bodies` collections, their rules, and read and write ports.
2. **The page**: `ui-rich-text`; the role's sheet reads the body when it
   opens and draws it between the summary and the ways to answer, with the
   first picture as the sheet's header.
3. **The editor**: Tiptap behind a lazy import in the programs editor, one
   body per language under the same language switch, with the «owed
   translation» rule the titles have.
4. **Pictures**: the upload callable and its Storage rules, the picture
   button in the toolbar, and removal of pictures a saved body no longer
   names.

Each step is its own pull request. Steps 1 and 2 need no new dependency.

## Open

- Whether a body is required for a role to be open, or optional (assumed
  optional).
- Whether courses and events get the editor in step 3 or after roles have
  been lived with (assumed together: they share the sheet and the editor).

## As built (steps 1–3, 2026-11-27)

- **The editor never sees an HTML string.** Tiptap's Markdown extension
  goes through HTML (`DOMParser`), which the security header guards, so it
  is not used. `RichTextSystem.write` is the parser's inverse (a round-trip
  property test holds the two together), and the editor is handed and asked
  for ProseMirror JSON, converted to and from the block list by pure
  functions. Tiptap's own style tag is off; its few rules are in the
  element's stylesheet.
- **Paste.** A paste or a drop from outside is taken as plain text before
  ProseMirror reads the clipboard's HTML. What was copied inside the editor
  is remembered by the editor itself, so pasting it back keeps its
  formatting without a Trusted Types policy.
- **Clearing a description removes its document** (`clearPositionBody`;
  the rules let the parent's writers delete a body). A thing with no
  description has no document.
- **Roles only, for now.** `/courses` and `/events` link a row straight to
  its one way of answering, and a list cannot know whether a sibling body
  exists, so showing a course's or an event's description needs those rows
  to open the sheet first. That is its own change; the ports, adapters and
  rules for both are in place.
- **Not yet checked under the deployed security header.** The dev server
  sends no `require-trusted-types-for`; the three sinks the library has
  were closed by reading its source. `verify:csp` should visit the editor
  before a release.

## As built (step 4, pictures, 2026-11-28)

- **The hand-off is the barber photo's.** The browser sizes the picture
  (long side at most 2 400 px), stages it under `pending/{userId}/…` and
  calls `addProgramImage` with the file's NAME. The callable asks who may
  (a token role that writes the programs pages — the rules'
  `isCatalogManager()`), checks the staged object's type and size, copies it
  to `media/programs/{programId}/{imageId}` and deletes the staged file. No
  document is read or written: a description names its pictures in its own
  text.
- **Not re-encoded on the server, and not WebP.** Decision 4 says the
  callable re-encodes; decision 3 names a `.webp` object. Neither is so.
  The functions hold no image library, and adding one (`sharp`, a native
  dependency) for this was not worth it; Safari cannot encode WebP from a
  canvas. So the BROWSER re-encodes to JPEG at the size cap, as the visit
  photos and the barber photo already do, and the server admits JPEG, PNG
  and WebP up to 5 MiB. The object has no extension; its type is the
  object's own. What this leaves open: a catalogue manager who skips the
  browser's step can store a picture wider than 2 400 px, up to 5 MiB.
- **A picture's id carries its size** — `{act}_{width}x{height}`. The act's
  name makes it unguessable and the same on a replay; the size lets the
  page hold the picture's place before its bytes arrive
  (`RichText.imageSize`), so the text under a picture does not jump. The
  size is the browser's claim and decides layout only.
- **A new role's pictures need a folder before the role is saved.** The
  editor draws the new role's id when its first picture is picked, and the
  save uses that id. The callable therefore does not ask that the role
  exists.
- **Removal is a sweep, after every save.** A trigger on each `…Bodies`
  document (`sweepPositionImagesOnBodyChange`, and the course's and the
  event's) lists the folder and deletes what the saved description does not
  name in any language — but only objects older than an hour, since a
  younger one may be held by an editor that has not saved yet. A removed
  description's pictures go the same way.
- **Limits.** 12 pictures per language (`ProgramImageSystem.admitBody`,
  refused before the save) and 48 objects per folder (the callable). The rules
  cannot count pictures in a string, so the 12 is not held by them.
- **Left behind, knowingly.** A picture removed from a text less than an
  hour after its upload stays until the next save after that hour. Pictures
  uploaded for a new role that is then never saved stay for good: nothing
  writes a description for that id, so no sweep runs. Both are bounded by
  the folder's cap and by who may upload.
- **In the editor.** A picture button, and picture files pasted or dropped
  in; a selected picture shows a row for its description (the alt text) and
  a button that takes it out. A picture just uploaded is shown from the
  bytes already in the browser.
- **Not built:** the first picture as the sheet's header (step 2's last
  clause), and pictures for courses and events (their descriptions are not
  shown yet).
