import { AccountStatus, User } from '@creativo/domain/accounts';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  BirthDate,
  DEFAULT_AUTH_DEPLOYMENT,
  RegistrationField,
  activeClaims,
  authStrategyRequires,
  roleFromPrimitive,
} from '@creativo/domain/identity';
import {
  AuthTokenPort,
  UserRepositoryPort,
  otpDestinationFromRaw,
} from '@creativo/application/identity';
import { ClockPort } from '@creativo/application/shared';
import { DEFAULT_TENANT_ID } from '../lib/otp/tenant';
import {
  ClaimsPromotionFailure,
  CompleteRegistrationError,
  InvalidBirthDateError,
  InvalidInputError,
  MissingRegistrationFieldError,
  RegistrationForbiddenError,
  RepositoryFailure,
  UnauthenticatedError,
  UserNotFoundError,
  UserValidationFailure,
} from './complete-registration.errors';
import { TenantId } from '@creativo/domain/models';

export interface CompleteRegistrationInput {
  kind: 'phone' | 'email';
  value: string;
  fields: Partial<Record<RegistrationField, string>>;
}

function parseInput(
  raw: unknown,
): Result<CompleteRegistrationInput, InvalidInputError> {
  if (typeof raw !== 'object' || raw === null) {
    return fail(new InvalidInputError('payload must be an object'));
  }
  const { kind, value, fields } = raw as Record<string, unknown>;
  if (kind !== 'phone' && kind !== 'email') {
    return fail(new InvalidInputError('kind must be "phone" or "email"'));
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(new InvalidInputError('missing or empty value'));
  }
  if (typeof fields !== 'object' || fields === null) {
    return fail(new InvalidInputError('missing fields'));
  }
  return ok({
    kind,
    value,
    fields: fields as Partial<Record<RegistrationField, string>>,
  });
}

/**
 * Finalizes a `new`-session sign-up: fills in the `AuthStrategy`-required
 * profile fields onto the user record `verifyOtpChallenge` already
 * provisioned, then mints+returns a *fresh* custom token carrying
 * `active` claims (mirrors `RegisterUserUseCase`'s client-side field
 * check — the server independently re-validates, never trusting the
 * caller). The client signs in again with this token (same pattern
 * `verifyOtpChallenge` already uses).
 *
 * Registration is BOUND to the caller's verified session: the callable
 * passes `request.auth.uid` (set by the custom-token sign-in that
 * `verifyOtpChallenge` performed), and completion is refused unless that
 * uid owns the user record the submitted identifier resolves to. Without
 * this, anyone knowing an identifier with a provisioned-but-unregistered
 * user could finish that registration with arbitrary names.
 *
 * Deliberately `createCustomToken` only — never *also*
 * `setUserClaims`/`setCustomUserClaims` on the same uid in the same
 * request: back-to-back Admin SDK claims-set + custom-token-mint calls
 * for one uid reliably produce `auth/internal-error` on the Auth
 * emulator's subsequent `signInWithCustomToken`. Minting a token with the
 * claims embedded directly avoids the conflict and needs no separate
 * claims-set call anyway — the fresh sign-in carries them regardless of
 * whatever the user's stored claims were before this call.
 */
/** Calendar-date validation zone for the optional birthday — UTC, same convention as the OTP use-cases' `OTP_ZONE`. */
const BIRTH_DATE_ZONE = 'UTC';

export class CompleteRegistrationUseCase {
  constructor(
    private readonly userRepository: UserRepositoryPort,
    private readonly authToken: AuthTokenPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(
    rawInput: unknown,
    callerUid: string | null,
  ): Promise<Result<{ customToken: string }, CompleteRegistrationError>> {
    if (!callerUid) {
      return fail(new UnauthenticatedError());
    }

    const inputResult = parseInput(rawInput);
    if (inputResult.isFailure()) {
      return fail(inputResult.error);
    }
    const input = inputResult.value;

    // The identifier itself already satisfies whichever of phone/email is
    // the login channel — the client never has to re-submit it as a form
    // field for the requirement to be met.
    const effectiveFields: Partial<Record<RegistrationField, string>> = {
      ...input.fields,
      [input.kind]: input.fields[input.kind] ?? input.value,
    };

    // The SAME shared deployment const the web app injects — server-side
    // re-validation reads the strategy from one source, not a local copy.
    const strategy = DEFAULT_AUTH_DEPLOYMENT.strategy;
    for (const field of strategy.required) {
      if (!authStrategyRequires(strategy, field)) continue;
      // eslint-disable-next-line security/detect-object-injection -- `field` is always one of the `RegistrationField` literals off `strategy.required`, never external input.
      const value = effectiveFields[field];
      if (!value?.trim()) {
        return fail(new MissingRegistrationFieldError(field));
      }
    }

    const todayResult = this.clock.now(BIRTH_DATE_ZONE);
    if (todayResult.isFailure()) {
      // Unreachable — BIRTH_DATE_ZONE ('UTC', hardcoded) is always valid.
      return fail(new InvalidInputError('invalid clock zone'));
    }
    const today = todayResult.value;

    // OPTIONAL birthday — absent/blank submissions skip validation entirely
    // (registering without one must stay exactly as before); a present value
    // must survive the domain VO's invariants (real ISO calendar date, in
    // the past, age 16–120) before it may touch the user document.
    const rawBirthDate = effectiveFields['birthDate']?.trim();
    let birthDateIso: string | undefined;
    if (rawBirthDate) {
      const birthDateResult = BirthDate.createFromISO(rawBirthDate, today);
      if (birthDateResult.isFailure()) {
        return fail(new InvalidBirthDateError(birthDateResult.error));
      }
      birthDateIso = birthDateResult.value.toISODate();
    }

    const destinationResult = otpDestinationFromRaw(
      input.value,
      input.kind === 'phone' ? 'sms' : 'email',
    );
    if (destinationResult.isFailure()) {
      return fail(new InvalidInputError('invalid identifier value'));
    }
    const destination = destinationResult.value;

    const userResult = await this.userRepository.findByDestination(destination);
    if (userResult.isFailure()) {
      return fail(new RepositoryFailure(userResult.error));
    }
    const user = userResult.value;
    if (!user) {
      return fail(new UserNotFoundError());
    }
    // `User.id` IS the Firebase Auth uid (`provisionAuthUser` seeded it) —
    // the caller may only complete the registration their own verified
    // session provisioned, never someone else's identifier.
    if (user.id.value !== callerUid) {
      return fail(new RegistrationForbiddenError());
    }

    // The registered profile is the REAL `domain/accounts` `User` — the
    // exact aggregate (and, through `saveRegistered`, the exact document
    // shape) the web's `FirestoreProfileAdapter` reconstitutes. `phone`/
    // `firstName`/`lastName` are guaranteed present by the strategy check
    // above (`required` always includes all three); the `?? ''` fallbacks
    // only narrow types, with the domain VOs rejecting an empty value as
    // defense-in-depth. Self-registration always lands as an `active`,
    // plain-`client` account — every other role/status is granted
    // out-of-band (Admin SDK), mirroring `firestore.rules`' create rule.
    const email = effectiveFields['email']?.trim() || (user.email ?? undefined);
    const birthDate = birthDateIso ?? user.birthDate ?? undefined;
    const registeredResult = User.create(
      {
        id: user.id.value,
        phone: effectiveFields['phone']?.trim() ?? '',
        firstName: effectiveFields['firstName']?.trim() ?? '',
        lastName: effectiveFields['lastName']?.trim() ?? '',
        roles: ['client'],
        status: AccountStatus.active(),
        ...(email !== undefined && { email }),
        ...(birthDate !== undefined && { birthDate }),
      },
      today,
    );
    if (registeredResult.isFailure()) {
      return fail(new UserValidationFailure(registeredResult.error));
    }

    const saveResult = await this.userRepository.saveRegistered(
      registeredResult.value,
    );
    if (saveResult.isFailure()) {
      return fail(new RepositoryFailure(saveResult.error));
    }

    // Best-effort identity chrome: the Auth record's displayName feeds the
    // header's account monogram via `AuthGateway.currentDisplayName()` —
    // session-cached, no Firestore read. A failure here must never fail an
    // otherwise-complete registration, so the Result is deliberately
    // ignored (the monogram falls back to the identifier's initial).
    await this.authToken.setDisplayName(
      registeredResult.value.id,
      `${registeredResult.value.firstName.value} ${registeredResult.value.lastName.value}`,
    );

    const tenantIdResult = TenantId.create(DEFAULT_TENANT_ID);
    if (tenantIdResult.isFailure()) {
      // Unreachable — DEFAULT_TENANT_ID is a known-valid non-empty literal.
      return fail(new InvalidInputError('invalid tenant'));
    }

    const claimsResult = activeClaims([roleFromPrimitive('client')]);
    if (claimsResult.isFailure()) {
      // Unreachable — the literal roles array above is never empty.
      return fail(new InvalidInputError('empty roles'));
    }

    const tokenResult = await this.authToken.createCustomToken(
      user.id,
      tenantIdResult.value,
      claimsResult.value,
    );
    if (tokenResult.isFailure()) {
      return fail(new ClaimsPromotionFailure(tokenResult.error));
    }

    return ok({ customToken: tokenResult.value });
  }
}
