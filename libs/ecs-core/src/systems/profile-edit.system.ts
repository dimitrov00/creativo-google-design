import {
  AccountLifecycle,
  type BirthDate,
  Email,
  Registration,
  type Role,
  Roles,
  type ProfileEdits,
} from '@core/components';
import { type LocalDate, Result } from '@core/primitives';
import { AccountsError, type RegistrationProfileError } from '@core/errors';
import type { OwnerProfileFields, User } from '@core/entities';
import { AgeSystem } from './age.system';
import { PhoneSystem } from './phone.system';
import type {
  RegisteredProfile,
  RegistrationSettlement,
} from './registration.system';
import { SearchFieldsSystem } from './search-fields.system';

/**
 * ProfileEditSystem — the ONE rule for an account's names and birth date
 * (identity flip (2), F2-6): the checks and the normalisation of the legacy
 * accounts aggregate (`User.create` over `FirstName`, `LastName`, `Email`,
 * the role vocabulary and the create-mode `BirthDate`), as pure functions
 * over the flat `User`.
 *
 * Two writers run it: the `updateProfile` pipeline inside its transaction,
 * and the web's `WriteOwnProfile` port inside the browser transaction (until
 * Phase 4 routes the owner's edits through the callable) — and
 * `completeRegistration` builds its registered profile with
 * {@link ProfileEditSystem.registrationProfile}.
 *
 * No instant input: the age window is judged on `ageDay`, the UTC civil
 * date the boundary derives ONCE from its clock (F2-7) — bucketing an
 * instant into a day here would be zone math inside a system.
 */

/** The name rule of `FirstName.create` / `LastName.create`: at least two characters once trimmed. */
export const NameRule = {
  MinLength: 2,
} as const;

/** Equal element by element, in order. */
function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The role vocabulary check of `User.validateRoles`: every unknown value
 * refused (all of them, in order); only a list with no unknown value can be
 * refused as empty.
 */
function roleRefusals(roles: readonly Role[]): readonly AccountsError[] {
  const out: AccountsError[] = [];
  for (let i = 0; i < roles.length; i++) {
    const role: unknown = roles[i];
    if (!Roles.isRole(role))
      out.push(AccountsError.userRoleInvalid(String(role)));
  }
  if (out.length === 0 && roles.length === 0) {
    out.push(AccountsError.userRolesEmpty());
  }
  return out;
}

export const ProfileEditSystem = {
  /**
   * The name rule (`FirstName.create` / `LastName.create` parity): each name
   * at least {@link NameRule.MinLength} characters once trimmed; a refusal
   * carries the text as given. First name before last name.
   */
  nameRefusals(firstName: string, lastName: string): readonly AccountsError[] {
    const out: AccountsError[] = [];
    if (firstName.trim().length < NameRule.MinLength) {
      out.push(AccountsError.firstNameTooShort(firstName, NameRule.MinLength));
    }
    if (lastName.trim().length < NameRule.MinLength) {
      out.push(AccountsError.lastNameTooShort(lastName, NameRule.MinLength));
    }
    return out;
  },

  /**
   * Whether names would change the stored ones — either differs from the
   * stored value, compared exactly: case counts («иван» → «Иван» is a
   * correction worth saving), and the names arrive as the write would
   * store them (trimmed — {@link decide} trims, the profile page passes its
   * trimmed drafts, the booking contact sheet the split of
   * {@link nameFromFull}). A provisioned account's `null` name differs from
   * every typed one. {@link decide}'s "unchanged" test composes it.
   */
  namesChanged(
    stored: {
      readonly firstName: string | null;
      readonly lastName: string | null;
    },
    firstName: string,
    lastName: string,
  ): boolean {
    return firstName !== stored.firstName || lastName !== stored.lastName;
  },

  /**
   * Whether a birth date would change the stored one — identity of the
   * branded day (`null` equals only `null`). {@link decide}'s "unchanged"
   * test composes it.
   */
  birthChanged(
    stored: { readonly birthDate: BirthDate | null },
    birthDate: BirthDate | null,
  ): boolean {
    return birthDate !== stored.birthDate;
  },

  /**
   * The profile names one typed full name would be saved as (the booking
   * contact sheet's single name field): everything up to the first run of
   * whitespace is the given name, the rest the family name with its spacing
   * settled to single spaces. A single word keeps `storedLastName` (`''`
   * when the profile has none) rather than erasing it; case stays. `null`
   * when nothing but whitespace was typed. The ONE split the sheet's
   * "would this change the profile" cue and its write both use.
   */
  nameFromFull(
    typed: string,
    storedLastName: string | null,
  ): { readonly firstName: string; readonly lastName: string } | null {
    const [first, ...rest] = typed.trim().split(/\s+/);
    if (first === undefined || first.length === 0) return null;
    return {
      firstName: first,
      lastName: rest.length > 0 ? rest.join(' ') : (storedLastName ?? ''),
    };
  },

  /**
   * The owner's edit of a stored account. `stored` absent, not
   * `REGISTERED` (a contact-only stub) or erased (Art. 17 — its live token
   * may still call within the hour after an erasure, audit-hardening Phase 3
   * P3-RU-17) → `ACCOUNTS_UPDATE_PROFILE_NOT_FOUND`.
   * Otherwise the effective names (the edit, else the stored one) go through
   * {@link nameRefusals} and the effective birth date (the edit, else the
   * stored one) through `AgeSystem.parseIso` on `ageDay` — today's
   * rebuild through the create-mode aggregate; any refusal →
   * `ACCOUNTS_UPDATE_PROFILE_VALIDATION_FAILED` (the wrapper today's
   * `UpdateProfileValidationFailure` answers). Else the five owner keys —
   * names trimmed, the search keys from the new names and the STORED phone
   * and e-mail (never a caller's: this write cannot change them) — or
   * `null` when all five equal the stored values ({@link namesChanged},
   * {@link birthChanged} and the search keys; value-idempotent: an
   * unchanged edit writes nothing).
   */
  decide(
    stored: User | null,
    edits: ProfileEdits,
    ageDay: LocalDate,
  ): Result<OwnerProfileFields | null, AccountsError> {
    if (
      stored === null ||
      !Registration.isRegistered(stored) ||
      AccountLifecycle.isErased(stored)
    ) {
      return Result.err(AccountsError.updateProfileNotFound());
    }
    const rawFirst = edits.firstName ?? stored.firstName ?? '';
    const rawLast = edits.lastName ?? stored.lastName ?? '';
    const rawBirth = edits.birthDate ?? stored.birthDate;
    let refused = ProfileEditSystem.nameRefusals(rawFirst, rawLast).length > 0;
    let birthDate: BirthDate | null = null;
    if (rawBirth !== null) {
      const parsed = AgeSystem.parseIso(rawBirth, ageDay);
      if (parsed.ok) birthDate = parsed.value;
      else refused = true;
    }
    if (refused) {
      return Result.err(AccountsError.updateProfileValidationFailed());
    }
    const firstName = rawFirst.trim();
    const lastName = rawLast.trim();
    const { searchName, searchPrefixes } = SearchFieldsSystem.searchFields(
      firstName,
      lastName,
      stored.phone,
      stored.email,
    );
    const unchanged =
      !ProfileEditSystem.namesChanged(stored, firstName, lastName) &&
      !ProfileEditSystem.birthChanged(stored, birthDate) &&
      searchName === stored.searchName &&
      sameStrings(searchPrefixes, stored.searchPrefixes);
    if (unchanged) return Result.ok(null);
    return Result.ok({
      firstName,
      lastName,
      birthDate,
      searchName,
      searchPrefixes,
    });
  },

  /**
   * The registered profile a settlement parses to — `User.create`'s checks
   * AND its normalisation, so `RegistrationSystem.register` receives a
   * branded profile and no caller casts: the phone through
   * `PhoneSystem.parse(raw, null)` (E.164 only, no default country —
   * `PhoneNumber.create` parity) to its `e164`; the names trimmed
   * ({@link nameRefusals}); a non-empty e-mail through `Email.parse` (trim +
   * lower-case; refused → `ACCOUNTS_EMAIL_INVALID`); the roles known and
   * non-empty (`ACCOUNTS_USER_ROLE_INVALID` / `ACCOUNTS_USER_ROLES_EMPTY`);
   * the settled birth date re-checked against the 16–120 window on `ageDay`
   * (the create mode — a birth after `ageDay` reads as too young, as the
   * legacy instant reader counted it). Every refusal is collected, in
   * today's order: phone, first name, last name, e-mail, roles, birth date.
   */
  registrationProfile(
    settlement: RegistrationSettlement,
    ageDay: LocalDate,
  ): Result<RegisteredProfile, readonly RegistrationProfileError[]> {
    const errors: RegistrationProfileError[] = [];
    const phone = PhoneSystem.parse(settlement.phone, null);
    if (!phone.ok) errors.push(phone.error);
    errors.push(
      ...ProfileEditSystem.nameRefusals(
        settlement.firstName,
        settlement.lastName,
      ),
    );
    let email: Email | null = null;
    if (settlement.email !== null && settlement.email.length > 0) {
      email = Email.parse(settlement.email);
      if (email === null) {
        errors.push(AccountsError.emailInvalid(settlement.email));
      }
    }
    errors.push(...roleRefusals(settlement.roles));
    if (settlement.birthDate !== null) {
      const refusal = AgeSystem.windowRefusal(
        AgeSystem.ageOn(settlement.birthDate, ageDay),
      );
      if (refusal !== null) errors.push(refusal);
    }
    if (!phone.ok || errors.length > 0) return Result.err(errors);
    return Result.ok({
      firstName: settlement.firstName.trim(),
      lastName: settlement.lastName.trim(),
      phone: phone.value.e164,
      email,
      birthDate: settlement.birthDate,
      roles: settlement.roles,
    });
  },
} as const;
