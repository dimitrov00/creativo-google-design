/**
 * THE DEV SEED'S ACCOUNTS (flip 2 — identity and accounts): `users/{uid}`
 * as `completeRegistration` leaves it — the flat `User` (`@core/entities`)
 * minus its `id` (Laws 5 and 6), every key at the root: `REGISTERED`, the
 * contact as E.164 / lower-cased e-mail, the names, the roles, `ACTIVE`, and
 * the clientele search keys `SearchFieldsSystem` derives (the ONE prefix
 * rule — the web, the functions and the seed share it; the seed's own
 * hand-kept copy is gone).
 *
 * WHO the accounts are and WHEN a birthday falls stay in the plan modules:
 * `tools/seed/fixtures.mjs` hands {@link clientUserBody} each client's
 * contact and the birth date its fixture places (Мартин's is today's month
 * and day); `tools/seed-dev-catalog.mjs` writes {@link staffAccountBody} at
 * the staff uid. `seed-data.spec.mjs` holds every body to the registration
 * rule (`ProfileEditSystem.registrationProfile`) and to what
 * `RegistrationSystem.register` writes over the provisioned stub.
 */
import {
  AccountLifecycle,
  BirthDate,
  Email,
  RegistrationState,
  Role,
} from '@core/components';
import type { User } from '@core/entities';
import { PhoneSystem, SearchFieldsSystem } from '@core/systems';
import { type Body, present, sure } from './catalog.fixtures';
import type { SeedClientContact } from './customers.fixtures';

/**
 * A registered account's body: the contact through its edge parses (a
 * refused fixture literal is a defect), the search keys of the names and
 * the contact channels, the account `ACTIVE`. Exported for the accounts a
 * proof writes beside the seed (`tools/verify/p0/verify-p0.mjs`'s
 * sysadmin), so no writer keeps a second copy of the body or the prefix
 * rule.
 */
export function registeredAccountBody(
  contact: SeedClientContact,
  roles: readonly Role[],
  birthDate: string | null,
): Body<User> {
  const phone = sure(
    PhoneSystem.parse(contact.phone, null),
    `phone ${contact.phone}`,
  ).e164;
  const email =
    contact.email === null
      ? null
      : present(Email.parse(contact.email), `email ${contact.email}`);
  return {
    registrationState: RegistrationState.Registered,
    phone,
    firstName: contact.firstName,
    lastName: contact.lastName,
    roles,
    ...AccountLifecycle.active(),
    email,
    birthDate:
      birthDate === null
        ? null
        : present(BirthDate.parse(birthDate), `birth date ${birthDate}`),
    ...SearchFieldsSystem.searchFields(
      contact.firstName,
      contact.lastName,
      phone,
      email,
    ),
  } satisfies Body<User>;
}

/**
 * `users/{uid}` of a seeded client: `client`, the profile it registered
 * with, and the birth date its fixture places (`'YYYY-MM-DD'`, or `null`).
 */
export function clientUserBody(
  contact: SeedClientContact,
  birthDate: string | null,
): Body<User> {
  return registeredAccountBody(contact, [Role.Client], birthDate);
}

/**
 * The STAFF account, so /staff is reachable in dev at all: Иван Колев,
 * `barber` + `admin`, signing in as `staff@test.local`. Only this document
 * matters — `verifyOtpChallenge` finds the account by its e-mail and mints
 * the roles read off it; the Auth user appears on the first sign-in.
 */
export const staffAccountBody: Body<User> = registeredAccountBody(
  {
    firstName: 'Иван',
    lastName: 'Колев',
    phone: '+35943012399',
    email: 'staff@test.local',
  },
  [Role.Barber, Role.Admin],
  null,
);
