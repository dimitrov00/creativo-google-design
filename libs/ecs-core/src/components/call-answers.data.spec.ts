import { describe, expect, it } from 'vitest';
import { PipelineErrorCode } from '@core/primitives';
import { BackfillCall } from './backfill-call.data';
import { CallAnswer } from './call-answer.data';
import { GovernanceCall } from './governance-call.data';
import { IdentityCall } from './identity-call.data';
import { InvitationCall } from './invitation-call.data';
import { ProfileEdits } from './profile-edits.data';
import { WaitlistCall } from './waitlist-call.data';

/*
 * The call components' answer decoders beside the booking wire's (Phase 4a
 * §3.2): each answer through its primitives' smart constructors; anything
 * else `PIPELINE_UNKNOWN`. The wire round trip with the server's encoders
 * lives in the `*.wire.spec.ts` files.
 */
const unusable = (result: { readonly ok: boolean; readonly error?: unknown }) =>
  !result.ok &&
  (result.error as { errorCode: string }).errorCode ===
    PipelineErrorCode.Unknown;

describe('CallAnswer — reading an answer', () => {
  it('reads an object’s own fields and nothing else', () => {
    const answer = CallAnswer.read({ a: 'x', b: 2, c: true });
    expect(answer).not.toBeNull();
    if (answer === null) return;
    expect(CallAnswer.text(answer, 'a')).toBe('x');
    expect(CallAnswer.whole(answer, 'b', 0)).toBe(2);
    expect(CallAnswer.whole(answer, 'b', 3)).toBeNull();
    expect(CallAnswer.flag(answer, 'c')).toBe(true);
    expect(CallAnswer.text(answer, 'missing')).toBeNull();
    expect(CallAnswer.read([1, 2])).toBeNull();
    expect(CallAnswer.read('x')).toBeNull();
  });
});

describe('WaitlistCall', () => {
  it('decodes the request id, or nothing usable', () => {
    expect(WaitlistCall.decodeRequested({ requestId: 'wl_1' })).toEqual({
      ok: true,
      value: { requestId: 'wl_1' },
    });
    expect(unusable(WaitlistCall.decodeRequested({ requestId: '' }))).toBe(
      true,
    );
    expect(unusable(WaitlistCall.decodeCancelled(undefined))).toBe(true);
  });
});

describe('IdentityCall', () => {
  it('decodes a challenge and its emulator code — absent is null', () => {
    expect(
      IdentityCall.decodeRequestOtpAnswer({
        challengeId: 'otp-1',
        devCode: '123456',
      }),
    ).toEqual({ ok: true, value: { challengeId: 'otp-1', devCode: '123456' } });
    expect(
      IdentityCall.decodeRequestOtpAnswer({
        challengeId: 'otp-1',
        devCode: null,
      }),
    ).toEqual({ ok: true, value: { challengeId: 'otp-1', devCode: null } });
    expect(
      unusable(IdentityCall.decodeRequestOtpAnswer({ devCode: '1' })),
    ).toBe(true);
  });

  it('decodes the session kind SCREAMING — the lowercase words are the retired wire', () => {
    expect(
      IdentityCall.decodeVerifyOtpAnswer({
        sessionKind: 'NEW',
        customToken: 't',
      }),
    ).toEqual({ ok: true, value: { sessionKind: 'NEW', customToken: 't' } });
    expect(
      unusable(
        IdentityCall.decodeVerifyOtpAnswer({
          sessionKind: 'new',
          customToken: 't',
        }),
      ),
    ).toBe(true);
    expect(
      unusable(
        IdentityCall.decodeCompleteRegistrationAnswer({ customToken: '' }),
      ),
    ).toBe(true);
    expect(IdentityCall.decodeUpdateProfileAnswer({ changed: false })).toEqual({
      ok: true,
      value: { changed: false },
    });
  });

  it('keeps an edit that changes nothing as every field null', () => {
    expect(ProfileEdits.keep()).toEqual({
      firstName: null,
      lastName: null,
      birthDate: null,
    });
  });
});

describe('GovernanceCall and InvitationCall', () => {
  it('decodes a started and an ended session', () => {
    expect(GovernanceCall.decodeStarted({ sessionId: 'imp-1' })).toEqual({
      ok: true,
      value: { sessionId: 'imp-1' },
    });
    expect(
      GovernanceCall.decodeEnded({
        sessionId: 'imp-1',
        impersonationEndReason: 'ADMIN_ENDED',
      }).ok,
    ).toBe(true);
    expect(
      unusable(
        GovernanceCall.decodeEnded({
          sessionId: 'imp-1',
          impersonationEndReason: 'admin_ended',
        }),
      ),
    ).toBe(true);
  });

  it('decodes a redemption and its count', () => {
    expect(
      InvitationCall.decodeRedeemed({
        invitationId: 'inv-1',
        redemptionCount: 1,
      }),
    ).toEqual({
      ok: true,
      value: { invitationId: 'inv-1', redemptionCount: 1 },
    });
    expect(
      unusable(
        InvitationCall.decodeRedeemed({
          invitationId: 'inv-1',
          redemptionCount: 0,
        }),
      ),
    ).toBe(true);
  });
});

describe('BackfillCall', () => {
  const PAGE = {
    backfillJobName: 'CLIENT_STATS',
    cursor: null,
    done: true,
    processed: 10,
    storedClients: 3,
    stamped: 2,
    recomputed: 1,
    total: 10,
    runStartedAtUtcMs: 1_790_575_200_000,
    startedFrom: null,
    sampleChecked: null,
    sampleMismatched: [],
    budgetSpent: false,
  };

  it('decodes a page — its start an instant, never ISO text', () => {
    expect(BackfillCall.decodePage(PAGE)).toEqual({ ok: true, value: PAGE });
    expect(
      unusable(
        BackfillCall.decodePage({
          ...PAGE,
          runStartedAtUtcMs: '2026-09-28T06:00:00Z',
        }),
      ),
    ).toBe(true);
    expect(
      unusable(
        BackfillCall.decodePage({ ...PAGE, backfillJobName: 'clientStats' }),
      ),
    ).toBe(true);
  });
});
