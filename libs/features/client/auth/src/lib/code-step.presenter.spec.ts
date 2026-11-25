import { describe, expect, it } from 'vitest';
import { WebmailProvider } from '@core/components';
import { IdentifierChannel } from '@core/primitives';
import { codeStepVm, type CodeStepInput } from './code-step.presenter';
import { CodeStepPhase } from './code-step.vm';
import { codeStepWordsOf } from './code-step.words';

/** The bg catalogue's words for `auth.code.*`, as the step prints them. */
const BG: ReadonlyMap<string, string> = new Map(
  Object.entries({
    'auth.code.sendingTitle': 'Изпращаме кода…',
    'auth.code.sendingTo': 'до',
    'auth.code.title.email': 'Провери пощата си',
    'auth.code.title.phone': 'Провери съобщенията си',
    'auth.code.sentTo': 'Изпратихме 6-цифрен код на',
    'auth.code.checking': 'Проверяваме…',
    'auth.code.doneTitle': 'Готово',
    'auth.settling': 'Влизаме в профила ти…',
    'auth.code.openWebmail': 'Отвори {{provider}}',
  }),
);

const words = codeStepWordsOf((key, params) => {
  const values = new Map(Object.entries(params ?? {}));
  return (BG.get(key) ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(values.get(name) ?? ''),
  );
});

const ABV = {
  webmailProvider: WebmailProvider.Abv,
  inboxUrl: 'https://www.abv.bg/',
} as const;

function vm(overrides: Partial<CodeStepInput>) {
  return codeStepVm({
    codeStepPhase: CodeStepPhase.Waiting,
    identifierChannel: IdentifierChannel.Email,
    destination: 'ivan@abv.bg',
    webmail: ABV,
    words,
    ...overrides,
  });
}

describe('codeStepVm', () => {
  it('words the send while it is out — never «Изпратихме», never «Проверяваме…»', () => {
    const sending = vm({ codeStepPhase: CodeStepPhase.Sending });
    expect(sending.title).toBe('Изпращаме кода…');
    expect(sending.lede).toBe('до');
    expect(sending.destination).toBe('ivan@abv.bg');
    expect(sending.discPhase).toBe('busy');
    expect(sending.locked).toBe(true);
    expect(sending.canEdit).toBe(false);
    expect(sending.webmail).toBeNull();
    // Nothing to resend while the code is on its way.
    expect(sending.showsResend).toBe(false);
  });

  it('asks the person to look for the code once it is out, with their webmail one tap away', () => {
    const waiting = vm({});
    expect(waiting.title).toBe('Провери пощата си');
    expect(waiting.lede).toBe('Изпратихме 6-цифрен код на');
    expect(waiting.discPhase).toBe('acknowledged');
    expect(waiting.locked).toBe(false);
    expect(waiting.canEdit).toBe(true);
    expect(waiting.showsResend).toBe(true);
    expect(waiting.webmail).toEqual({
      label: 'Отвори ABV',
      href: 'https://www.abv.bg/',
    });
  });

  it('asks a phone deployment to look at its messages, with no webmail', () => {
    const waiting = vm({
      identifierChannel: IdentifierChannel.Phone,
      destination: '+359888123456',
      webmail: null,
    });
    expect(waiting.title).toBe('Провери съобщенията си');
    expect(waiting.webmail).toBeNull();
  });

  it('offers no shortcut for an address no webmail names', () => {
    expect(vm({ webmail: null }).webmail).toBeNull();
  });

  it('turns the ring again while checking, keeping where the code went', () => {
    const checking = vm({ codeStepPhase: CodeStepPhase.Checking });
    expect(checking.title).toBe('Проверяваме…');
    expect(checking.lede).toBe('Изпратихме 6-цифрен код на');
    expect(checking.discPhase).toBe('busy');
    expect(checking.locked).toBe(true);
    expect(checking.webmail).toBeNull();
  });

  it('says it is done on an accepted code, and forgets the destination', () => {
    const accepted = vm({ codeStepPhase: CodeStepPhase.Accepted });
    expect(accepted.title).toBe('Готово');
    expect(accepted.lede).toBe('Влизаме в профила ти…');
    expect(accepted.destination).toBeNull();
    expect(accepted.discPhase).toBe('complete');
    expect(accepted.accepted).toBe(true);
    expect(accepted.locked).toBe(true);
    expect(accepted.canEdit).toBe(false);
    expect(accepted.webmail).toBeNull();
    expect(accepted.showsResend).toBe(false);
  });

  it('prints every webmail by its brand', () => {
    expect(
      vm({
        webmail: {
          webmailProvider: WebmailProvider.Gmail,
          inboxUrl: 'https://mail.google.com/mail/',
        },
      }).webmail?.label,
    ).toBe('Отвори Gmail');
  });
});
