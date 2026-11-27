# Rich text for programs and posts (2026-11-27)

> **Status: DECIDED by Claude under the owner's standing delegation
> (2026-10-26), awaiting the owner's read. Not built.** The owner asked on
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
