import type { LocalizedText } from './localized-text.data';
import type { ProgramContact } from './program-contact.data';

/** An event as the admin typed it. */
export type ShopEventInput = {
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  /** The shop wall clock exactly as `<input type="datetime-local">` emits it: `YYYY-MM-DDTHH:mm`. */
  readonly startsAt: string;
  /** Blank (after trimming) = not tied to one shop. */
  readonly locationId: string;
  /** The ways to answer it, as typed; an entry with a blank value is dropped. */
  readonly contacts: readonly ProgramContact[];
  readonly sortOrder: number;
};
