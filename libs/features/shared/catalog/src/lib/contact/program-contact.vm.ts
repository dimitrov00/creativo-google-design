import {
  ContactMethod,
  type ContactLink,
  type WorkplaceMode,
} from '@core/components';
import type { UiIconName } from '@creativo/ui/controls';

/*
 * HOW A PROGRAM IS ANSWERED, AS A PAGE SHOWS IT (Law 10.3) — the display
 * model `/careers`, `/courses` and `/events` share, and the glyph each
 * method leads with (the admin's menu reads the same table). Filled by
 * `program-contact.presenter.ts`; no function lives here.
 */

/** A row's answer: every way to answer, and the one a tap opens outright. */
export type ContactRowVm = {
  /** Every way, in the stored order — never empty (the shop's Instagram stands in). */
  readonly contacts: readonly ContactLink[];
  /** The only way, when there is exactly one: the row is then a plain link to it. */
  readonly only: ContactLink | null;
};

/**
 * What the contact sheet is opened for: the thing's name and the ways to
 * answer it — and, when the page has them, its words in full and where it
 * is worked, which make the sheet the thing's own page.
 */
export type ContactSheetVm = {
  readonly title: string;
  /** The thing's description, whole; absent or `null` prints none. */
  readonly summary?: string | null;
  /** The workplace tag the sheet words (`programs.workplace.<tag>`). */
  readonly workplaceTag?: WorkplaceMode | null;
  /** «Център · Младост» — the shops, already worded. */
  readonly shopsLine?: string | null;
  readonly contacts: readonly ContactLink[];
};

/** The glyph a method leads with. */
export const CONTACT_ICON = {
  [ContactMethod.Phone]: 'contact.phone',
  [ContactMethod.Email]: 'contact.email',
  [ContactMethod.Instagram]: 'social.instagram',
  [ContactMethod.Link]: 'link.external',
} as const satisfies Record<ContactMethod, UiIconName>;
