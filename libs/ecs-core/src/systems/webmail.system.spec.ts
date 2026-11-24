import { describe, expect, it } from 'vitest';
import {
  E164,
  Email,
  ParsedIdentifier,
  WebmailProvider,
} from '@core/components';
import { deepFreeze } from '@core/testing';
import { WebmailSystem } from './webmail.system';

function email(raw: string): ParsedIdentifier {
  const parsed = Email.parse(raw);
  if (parsed === null) throw new Error(`fixture address invalid: ${raw}`);
  return ParsedIdentifier.email(parsed);
}

describe('WebmailSystem.inboxOf', () => {
  it('answers the service and its web inbox for a known domain', () => {
    expect(WebmailSystem.inboxOf(email('ivan.petrov@abv.bg'))).toEqual({
      webmailProvider: WebmailProvider.Abv,
      inboxUrl: 'https://www.abv.bg/',
    });
    expect(WebmailSystem.inboxOf(email('maria@gmail.com'))).toEqual({
      webmailProvider: WebmailProvider.Gmail,
      inboxUrl: 'https://mail.google.com/mail/',
    });
  });

  it('folds a service’s other domains into it', () => {
    expect(
      WebmailSystem.inboxOf(email('a@googlemail.com'))?.webmailProvider,
    ).toBe(WebmailProvider.Gmail);
    expect(WebmailSystem.inboxOf(email('a@hotmail.com'))?.webmailProvider).toBe(
      WebmailProvider.Outlook,
    );
    expect(WebmailSystem.inboxOf(email('a@me.com'))?.webmailProvider).toBe(
      WebmailProvider.ICloud,
    );
  });

  it('reads the address as `Email.parse` keeps it — trimmed and lower-cased', () => {
    expect(
      WebmailSystem.inboxOf(email('  Ivan@ABV.BG '))?.webmailProvider,
    ).toBe(WebmailProvider.Abv);
  });

  it('matches the whole domain, never a suffix or a prefix of one', () => {
    expect(WebmailSystem.inboxOf(email('a@gmail.com.example.net'))).toBeNull();
    expect(WebmailSystem.inboxOf(email('a@notgmail.com'))).toBeNull();
    expect(WebmailSystem.inboxOf(email('a@mail.gmail.com'))).toBeNull();
  });

  it('offers nothing for a domain it does not know', () => {
    expect(WebmailSystem.inboxOf(email('owner@creativo.bg'))).toBeNull();
  });

  it('offers nothing for a phone — an SMS has no inbox to open', () => {
    const phone = E164.parse('+359888123456');
    if (!phone.ok) throw new Error('fixture phone invalid');
    expect(
      WebmailSystem.inboxOf(ParsedIdentifier.phone(phone.value)),
    ).toBeNull();
  });

  it('gives every service a web inbox on https', () => {
    const domains = [
      [WebmailProvider.Gmail, 'gmail.com'],
      [WebmailProvider.Outlook, 'outlook.com'],
      [WebmailProvider.Yahoo, 'yahoo.com'],
      [WebmailProvider.ICloud, 'icloud.com'],
      [WebmailProvider.Proton, 'proton.me'],
      [WebmailProvider.Abv, 'abv.bg'],
      [WebmailProvider.MailBg, 'mail.bg'],
    ] as const;
    expect(domains.map(([provider]) => provider).sort()).toEqual(
      Object.values(WebmailProvider).sort(),
    );
    for (const [provider, domain] of domains) {
      const inbox = WebmailSystem.inboxOf(email(`a@${domain}`));
      expect(inbox?.webmailProvider).toBe(provider);
      expect(inbox?.inboxUrl.startsWith('https://')).toBe(true);
    }
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const identifier = deepFreeze(email('ivan@abv.bg'));
    expect(WebmailSystem.inboxOf(identifier)).toEqual(
      WebmailSystem.inboxOf(identifier),
    );
  });
});
