import type { DurationMinutes } from '@core/primitives';

/**
 * The sign-in code e-mail — the words of the login-OTP sender identity
 * (`postmark-otp-sender.adapter.ts`), and only of it: a campaign never
 * borrows them, as it never borrows the sender (owner rule, 2026-11-17).
 *
 * Shaped like the codes Apple and the banks send: the code in the subject,
 * so a notification shows it and the phone's code autofill finds it; one
 * line of what to do with it and how long it lasts; one line that it is
 * never asked for; one line for a person who did not ask. It echoes
 * nothing the caller typed — not the address, not a name — so the message
 * carries no input of anyone's, and the code is escaped all the same.
 *
 * Bulgarian, the deployment's language: the request carries no locale yet.
 * Pure: the code and the deployment's code lifetime in, three strings out.
 */

/** The three bodies of one message, as the provider's send call names them. */
export type OtpEmail = {
  readonly subject: string;
  readonly textBody: string;
  readonly htmlBody: string;
};

const BRAND = 'Creativo';

/** «1 минута», «5 минути» — Bulgarian has one plural for every count past one. */
function minutesWord(minutes: DurationMinutes): string {
  return minutes === 1 ? '1 минута' : `${minutes} минути`;
}

const HTML_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES.get(char) ?? char);
}

/** The message that carries `code`, which lasts `ttlMinutes`. */
export function otpEmailOf(
  code: string,
  ttlMinutes: DurationMinutes,
): OtpEmail {
  const lasts = `Въведи го в ${BRAND}, за да влезеш. Важи ${minutesWord(ttlMinutes)}.`;
  const never =
    'Не го казвай на никого — никой от екипа няма да те попита за него.';
  const unasked =
    'Не очакваше това писмо? Просто го пренебрегни — без кода никой не може да влезе с твоя адрес.';
  const safeCode = escapeHtml(code);

  const textBody = [
    'Кодът ти за вход:',
    '',
    code,
    '',
    lasts,
    '',
    never,
    unasked,
    '',
    `— ${BRAND}`,
    '',
  ].join('\n');

  // Table layout and inline styles: what every mail client renders alike.
  // Ink on white with the code on a quiet fill — no accent, no image, no
  // link, nothing tracked.
  const htmlBody = `<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Кодът ти за вход</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(lasts)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;">
<tr><td style="font-size:15px;font-weight:600;padding-bottom:24px;">${BRAND}</td></tr>
<tr><td style="font-size:24px;font-weight:700;line-height:1.25;padding-bottom:16px;">Кодът ти за вход</td></tr>
<tr><td style="padding-bottom:20px;"><div style="display:inline-block;background:#f2f2f7;border-radius:12px;padding:14px 20px;font-size:34px;font-weight:700;letter-spacing:6px;font-variant-numeric:tabular-nums;">${safeCode}</div></td></tr>
<tr><td style="font-size:15px;line-height:1.5;padding-bottom:24px;">${escapeHtml(lasts)}</td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#6e6e73;padding-bottom:8px;">${escapeHtml(never)}</td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#6e6e73;">${escapeHtml(unasked)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;

  return { subject: `Кодът ти за вход: ${code}`, textBody, htmlBody };
}
