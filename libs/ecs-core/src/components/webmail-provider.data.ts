/**
 * The webmail services the code step can open for a person, read from their
 * address's domain (`WebmailSystem.inboxOf`) — the field `webmailProvider`.
 * Law 1: read from this dictionary, never a bare `'GMAIL'` at a use site.
 * The brand each one prints as is the code step's display table, not here.
 */
export const WebmailProvider = {
  Gmail: 'GMAIL',
  Outlook: 'OUTLOOK',
  Yahoo: 'YAHOO',
  ICloud: 'ICLOUD',
  Proton: 'PROTON',
  /** ABV (abv.bg), the largest Bulgarian free mail. */
  Abv: 'ABV',
  /** Mail.bg. */
  MailBg: 'MAIL_BG',
} as const;
export type WebmailProvider =
  (typeof WebmailProvider)[keyof typeof WebmailProvider];
