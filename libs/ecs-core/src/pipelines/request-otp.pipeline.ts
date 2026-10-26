import {
  AuthStrategyKind,
  Identifier,
  type OtpDestinationType,
  OtpPurpose,
  ParsedIdentifier,
} from '@core/components';
import { type OtpId, Result } from '@core/primitives';
import { IdentityError, type RequestOtpError } from '@core/errors';
import type {
  AuthDeploymentPorts,
  ClockPorts,
  IdPorts,
  OtpCryptoPorts,
  OtpDeliveryPorts,
  OtpStorePorts,
  TelemetryPorts,
  TenantPorts,
} from '@core/ports';
import { OtpSystem } from '@core/systems';
import { parseContactPhone } from './booking-read-set.pipeline';

/**
 * `requestOtp` — a new login challenge for a phone or an e-mail (blueprint
 * §4.1; identity flip (2), §3.2): the successor of the legacy
 * `RequestOtpUseCase` (deleted in Phase 4b) and the `requestOtpChallenge`
 * handler, as one sandwich with no transaction (as before — the resend
 * window is the throttle, a lost race costs one extra code).
 *
 * The order is frozen, refusal by refusal: (1) the deployment's ONE
 * challenge channel (`OtpSystem.channelAccepts`; a magic-link deployment
 * issues no codes at all) → `IDENTITY_OTP_CHANNEL_MISMATCH`; (2) the
 * destination parsed on that channel (an e-mail through `Email.parse`, a
 * phone through `PhoneSystem.parse` with no default country — the kernel's
 * rule) → `IDENTITY_IDENTIFIER_INVALID`; (3) the open challenges of the
 * PARSED destination created inside the resend window (`loadOpenOtps`,
 * index #10) → `IDENTITY_OTP_RATE_LIMITED`, carrying the seconds left on
 * that window (`OtpSystem.retryAfterSeconds`, OR-9) so the code step
 * restarts its countdown instead of showing a dead end; (4) the tenant;
 * then the challenge is issued with the strategy's own
 * `ttlMinutes`/`maxAttempts`, saved (`saveOtp`, which stamps `purgeAt`) and
 * sent. A send failure is answered as such — the saved challenge stays, as
 * today — and so is the deployed sender's refusal
 * (`IDENTITY_OTP_SEND_UNAVAILABLE`, audit-hardening WS-0), passed through
 * unchanged so the edge words it as its own code. The save and the resend
 * window still come BEFORE the send: an unwired sender refuses every
 * request that reaches it, its saved challenge is TTL-purged and
 * unreachable without a delivered code, and sending first would change what
 * the OR-9 window counts. The cost, under that sender: the refused request
 * used up the window, so a repeat for the same destination inside it
 * answers `IDENTITY_OTP_RATE_LIMITED` (worded as a code already sent,
 * though none was) before the refusal answers again.
 *
 * The stored `destination` is the payload text TRIMMED, byte-identical to
 * today (F2-10): the probe queries the parsed identifier while the challenge
 * stores the trimmed raw value, today's exact pair.
 *
 * The raw code is answered to the edge (never stored) so the callable can
 * echo it under the emulator only (`devCode`); production never forwards it.
 */

export type RequestOtpPorts = TenantPorts &
  OtpStorePorts &
  OtpDeliveryPorts &
  OtpCryptoPorts &
  AuthDeploymentPorts &
  ClockPorts &
  IdPorts &
  TelemetryPorts;

export type RequestOtpCommand = {
  /** The channel the caller asked for — `'phone'` → `SMS`, anything else → `EMAIL` (the decoder never refuses it). */
  readonly otpDestinationType: OtpDestinationType;
  /**
   * The payload's `value` as sent — the decoder refused it only when blank.
   * Parsed here on the asked channel, and trimmed ONCE for the stored
   * `destination` (F2-10, the stated Law 7.4 exception: its refusal must
   * follow the channel check).
   */
  readonly rawDestination: string;
};

export type RequestOtpAnswer = {
  readonly otpId: OtpId;
  /** The code drawn for this challenge — for the emulator's `devCode` only. */
  readonly rawCode: string;
};

export const requestOtp =
  (ports: RequestOtpPorts) =>
  async (
    cmd: RequestOtpCommand,
  ): Promise<Result<RequestOtpAnswer, RequestOtpError>> => {
    const strategy = ports.authDeployment.strategy;
    const identifierChannel = ParsedIdentifier.channelOfDestination(
      cmd.otpDestinationType,
    );
    // The `EmailLink` clause never changes the verdict (`channelAccepts`
    // already refuses it); it narrows the strategy to an OTP one, whose
    // policy carries `maxAttempts`.
    if (
      !OtpSystem.channelAccepts(strategy, cmd.otpDestinationType) ||
      strategy.authStrategyKind === AuthStrategyKind.EmailLink
    ) {
      return Result.err(
        IdentityError.otpChannelMismatch(
          identifierChannel,
          strategy.authStrategyKind,
        ),
      );
    }

    const parsed = ParsedIdentifier.parse(
      identifierChannel,
      cmd.rawDestination,
      parseContactPhone,
    );
    if (!parsed.ok) return parsed;

    const nowUtcMs = ports.nowUtcMs();
    const open = await ports.loadOpenOtps(
      parsed.value.identifier,
      OtpSystem.resendWindowStartUtcMs(nowUtcMs),
    );
    if (!open.ok) return open;
    if (!OtpSystem.mayIssue(open.value, nowUtcMs)) {
      return Result.err(
        IdentityError.otpRateLimited(
          OtpSystem.retryAfterSeconds(open.value, nowUtcMs),
        ),
      );
    }

    const tenant = await ports.loadTenant();
    if (!tenant.ok) return tenant;

    const rawCode = ports.otpCrypto.nextCode();
    const salt = ports.otpCrypto.nextSalt();
    const otp = OtpSystem.issue(
      {
        tenantId: tenant.value,
        destination: Identifier.of(cmd.rawDestination.trim()),
        otpDestinationType: cmd.otpDestinationType,
        otpPurpose: OtpPurpose.Login,
        // The narrowed OTP strategy's own policy — the numbers the client
        // reads off the same deployment, never a local copy.
        ttlMinutes: strategy.policy.ttlMinutes,
        maxAttempts: strategy.policy.maxAttempts,
      },
      { codeHash: ports.otpCrypto.hashCode(rawCode, salt), salt },
      nowUtcMs,
      ports.nextId,
    );

    const saved = await ports.saveOtp(otp);
    if (!saved.ok) return saved;

    const sent = await ports.sendOtp(parsed.value, rawCode);
    if (!sent.ok) {
      ports.log('warn', 'otp.send_failed', {
        otpId: otp.id,
        errorCode: sent.error.errorCode,
      });
      return sent;
    }

    return Result.ok({ otpId: otp.id, rawCode });
  };
