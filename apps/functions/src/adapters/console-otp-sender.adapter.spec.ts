import { E164, Email, ParsedIdentifier } from '@core/components';
import type { Log, OtpDeliveryPorts } from '@core/ports';
import { consoleOtpSender } from './console-otp-sender.adapter';

type Line = {
  readonly level: Parameters<Log>[0];
  readonly msg: string;
  readonly fields: Parameters<Log>[2];
};

function recordingLog(): { readonly log: Log; readonly lines: Line[] } {
  const lines: Line[] = [];
  return {
    lines,
    log: (level, msg, fields) => {
      lines.push({ level, msg, fields });
    },
  };
}

describe('console-otp-sender adapter (the login-OTP sender)', () => {
  it('is the OtpDeliveryPorts bundle', () => {
    const ports: OtpDeliveryPorts = consoleOtpSender(recordingLog().log);
    expect(Object.keys(ports)).toEqual(['sendOtp']);
    expect(typeof ports.sendOtp).toBe('function');
  });

  it('logs the legacy line for a phone — one info line, word for word', async () => {
    const { log, lines } = recordingLog();
    const result = await consoleOtpSender(log).sendOtp(
      ParsedIdentifier.phone(E164.of('+359888123456')),
      '042917',
    );
    expect(result).toEqual({ ok: true, value: undefined });
    expect(lines).toEqual([
      {
        level: 'info',
        msg: '[otp] would send sms OTP to +359888123456: 042917',
        fields: undefined,
      },
    ]);
  });

  it('names the e-mail channel for an e-mail destination', async () => {
    const { log, lines } = recordingLog();
    await consoleOtpSender(log).sendOtp(
      ParsedIdentifier.email(Email.of('ana@example.com')),
      '123456',
    );
    expect(lines.map((line) => line.msg)).toEqual([
      '[otp] would send email OTP to ana@example.com: 123456',
    ]);
  });

  it('never fails — there is no delivery to fail yet', async () => {
    const { sendOtp: send } = consoleOtpSender(() => undefined);
    await expect(
      send(ParsedIdentifier.phone(E164.of('+359888000000')), '000000'),
    ).resolves.toEqual({ ok: true, value: undefined });
  });
});
