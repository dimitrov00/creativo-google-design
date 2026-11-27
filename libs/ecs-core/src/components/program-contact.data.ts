/**
 * How a role, a course or an event is answered — the field `contactMethod`
 * of each of its `contacts`. The dictionary's order is the order the editor
 * offers them in.
 */
export const ContactMethod = {
  Phone: 'PHONE',
  Email: 'EMAIL',
  Instagram: 'INSTAGRAM',
  Link: 'LINK',
} as const;
export type ContactMethod = (typeof ContactMethod)[keyof typeof ContactMethod];

/**
 * One way to answer a program — an entry of its `contacts` array (a true
 * 1-to-N: a role may be answered by phone AND by e-mail). Stored canonical
 * by `ProgramsSystem`: a phone as E.164, an e-mail trimmed and lower-cased,
 * an Instagram handle bare (no `@`, no address), a link as the URL typed.
 * The same struct is the admin form's raw entry, before the system judges
 * it. At most one entry per method.
 */
export type ProgramContact = {
  readonly contactMethod: ContactMethod;
  readonly contactValue: string;
};

/**
 * A contact as a page offers it: the method (its word is the page's) and
 * the address a tap opens — `tel:`, `mailto:`, the Instagram profile, the
 * link itself. Derived on demand by `ProgramsSystem.contactLinks`, never
 * stored.
 */
export type ContactLink = {
  readonly contactMethod: ContactMethod;
  readonly href: string;
};
