import type { LocalizedText } from '@core/components';
import type { CourseId, EventId, PositionId } from '@core/primitives';

/*
 * THE BODIES — the description staff write for a role, a course or an
 * event: headings, lists, links, pictures. Each is a SIBLING document of
 * the thing it describes, under the same id (`positionBodies/{id}` beside
 * `positions/{id}`), so a list page never downloads a body to print one
 * line and a body is read once, when its thing is opened. The document is
 * the type minus `id` (Law 5): `{ body }`, the Markdown subset
 * `RichTextSystem.parse` reads, one string per language, each at most
 * `RichText.BODY_MAX_CHARS`. A thing with no body has no document.
 *
 * Decided in
 * `docs/architecture/decisions/2026-11-27-rich-text-for-programs-and-posts.md`.
 */

/** A role's description — `positionBodies/{id}`, keyed by its role's id. */
export type PositionBody = {
  readonly id: PositionId;
  /** Markdown, per language. */
  readonly body: LocalizedText;
};

/** A course's description — `courseBodies/{id}`, keyed by its course's id. */
export type CourseBody = {
  readonly id: CourseId;
  /** Markdown, per language. */
  readonly body: LocalizedText;
};

/** An event's description — `eventBodies/{id}`, keyed by its event's id. */
export type ShopEventBody = {
  readonly id: EventId;
  /** Markdown, per language. */
  readonly body: LocalizedText;
};
