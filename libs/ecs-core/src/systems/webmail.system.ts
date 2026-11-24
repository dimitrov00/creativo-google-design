import { IdentifierChannel } from '@core/primitives';
import { type ParsedIdentifier, WebmailProvider } from '@core/components';

/** Where a person's mail can be opened from the code step: the service and its inbox on the web. */
export type WebmailInbox = {
  readonly webmailProvider: WebmailProvider;
  /** The service's own web inbox, opened in a new tab. */
  readonly inboxUrl: string;
};

/**
 * The address domains each service hands out — exact matches on the part
 * after the `@`, never a suffix (`gmail.com.example.net` is nobody's
 * Gmail). The common free services, plus the two Bulgarian ones the shop's
 * clients write in with.
 */
const DOMAINS: Readonly<Record<string, WebmailProvider>> = {
  'gmail.com': WebmailProvider.Gmail,
  'googlemail.com': WebmailProvider.Gmail,
  'outlook.com': WebmailProvider.Outlook,
  'hotmail.com': WebmailProvider.Outlook,
  'live.com': WebmailProvider.Outlook,
  'msn.com': WebmailProvider.Outlook,
  'yahoo.com': WebmailProvider.Yahoo,
  'ymail.com': WebmailProvider.Yahoo,
  'icloud.com': WebmailProvider.ICloud,
  'me.com': WebmailProvider.ICloud,
  'mac.com': WebmailProvider.ICloud,
  'proton.me': WebmailProvider.Proton,
  'protonmail.com': WebmailProvider.Proton,
  'pm.me': WebmailProvider.Proton,
  'abv.bg': WebmailProvider.Abv,
  'mail.bg': WebmailProvider.MailBg,
};

/** Each service's web inbox — where a signed-in person lands on their mail. */
const INBOX_URLS = {
  [WebmailProvider.Gmail]: 'https://mail.google.com/mail/',
  [WebmailProvider.Outlook]: 'https://outlook.live.com/mail/',
  [WebmailProvider.Yahoo]: 'https://mail.yahoo.com/',
  [WebmailProvider.ICloud]: 'https://www.icloud.com/mail/',
  [WebmailProvider.Proton]: 'https://mail.proton.me/',
  [WebmailProvider.Abv]: 'https://www.abv.bg/',
  [WebmailProvider.MailBg]: 'https://mail.bg/',
} as const satisfies Record<WebmailProvider, string>;

/**
 * WebmailSystem — which webmail, if any, a code was sent to, so the code
 * step can offer «Отвори Gmail» beside the six slots (owner, 2026-11-23:
 * direction B of the sign-in code screens). Pure: the identifier's
 * canonical address in, the service and its inbox out; a phone, or a
 * domain no table here names (a company's own mail), answers `null` and
 * the step offers nothing.
 */
export const WebmailSystem = {
  inboxOf(identifier: ParsedIdentifier): WebmailInbox | null {
    if (identifier.identifierChannel !== IdentifierChannel.Email) return null;
    const address: string = identifier.identifier;
    const domain = address.slice(address.lastIndexOf('@') + 1);
    if (!Object.hasOwn(DOMAINS, domain)) return null;
    const webmailProvider = DOMAINS[domain] as WebmailProvider;
    return { webmailProvider, inboxUrl: INBOX_URLS[webmailProvider] };
  },
} as const;
