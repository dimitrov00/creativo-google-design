import { DurationMinutes } from '@core/primitives';
import { unwrapOk } from '@core/testing';
import { otpEmailOf } from './otp-email.words';

const minutes = (n: number) => unwrapOk(DurationMinutes.of(n));

describe('otp-email words (the sign-in code e-mail)', () => {
  it('puts the code in the subject, where a notification and code autofill find it', () => {
    expect(otpEmailOf('482913', minutes(5)).subject).toBe(
      'Кодът ти за вход: 482913',
    );
  });

  it('pins the plain-text body — the code on its own line, how long it lasts, never asked for, ignore if unexpected', () => {
    expect(otpEmailOf('482913', minutes(5)).textBody).toBe(
      [
        'Кодът ти за вход:',
        '',
        '482913',
        '',
        'Въведи го в Creativo, за да влезеш. Важи 5 минути.',
        '',
        'Не го казвай на никого — никой от екипа няма да те попита за него.',
        'Не очакваше това писмо? Просто го пренебрегни — без кода никой не може да влезе с твоя адрес.',
        '',
        '— Creativo',
        '',
      ].join('\n'),
    );
  });

  it('words the lifetime from the deployment’s figure — «1 минута», «10 минути»', () => {
    expect(otpEmailOf('000000', minutes(1)).textBody).toContain(
      'Важи 1 минута.',
    );
    expect(otpEmailOf('000000', minutes(10)).textBody).toContain(
      'Важи 10 минути.',
    );
  });

  it('carries the same words in the HTML body: Bulgarian, the code once, no link, no image, no tracking pixel', () => {
    const html = otpEmailOf('482913', minutes(5)).htmlBody;
    expect(html).toContain('<html lang="bg">');
    expect(html.match(/482913/g)).toHaveLength(1);
    expect(html).toContain('Важи 5 минути.');
    expect(html).not.toMatch(/<a\s|<img\s|https?:\/\//i);
  });

  it('escapes what it prints — a code is digits, and stays text whatever it holds', () => {
    const html = otpEmailOf('<b>&"', minutes(5)).htmlBody;
    expect(html).toContain('&lt;b&gt;&amp;&quot;');
    expect(html).not.toContain('<b>&"');
  });

  it('is pure — the same input words the same message', () => {
    expect(otpEmailOf('482913', minutes(5))).toEqual(
      otpEmailOf('482913', minutes(5)),
    );
  });
});
