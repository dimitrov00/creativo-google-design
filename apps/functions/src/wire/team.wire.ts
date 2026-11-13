import {
  AuthoredText,
  BarberEdit,
  type BarberEditRequest,
  BarberLifecycle,
  Roles,
} from '@core/components';
import { TeamError } from '@core/errors';
import {
  BarberId,
  LocalDate,
  LocationId,
  type OperationId,
  Result,
  StoredFields,
  Tag,
} from '@core/primitives';
import {
  type ActivateBarberCommand,
  type AddBarberCommand,
  admitTeamCaller,
  admitTeamStaffCaller,
  type DeleteDraftBarberCommand,
  type EditBarberCommand,
  type TeamCaller,
} from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerKnownRoles, callerUserId } from '../lib/booking/caller-roles';
import {
  idOf,
  idsOf,
  operationIdOf,
  type Payload,
  payloadOf,
  type WireRequest,
} from './wire-read';

/**
 * THE TEAM CALLABLES' WIRE (team onboarding D5, D9, D10,
 * `docs/designs/team-onboarding.md`) — `addBarber`, `editBarber`,
 * `activateBarber`, `deleteDraftBarber`. The caller and their roles come
 * off the VERIFIED token, never the payload, and the token gate is asked
 * before the payload is read (`TEAM_UNAUTHENTICATED`, `TEAM_FORBIDDEN`):
 * the team manager's for a new record, a deletion and every edit but the
 * profile; any staff role's for a profile and the go-live step — the
 * pipeline judges the STORED account after it. Every field is re-read
 * through its smart constructor or guard, the first unreadable one named
 * (`TEAM_INVALID_INPUT`). The act's name (`operationId`) is REQUIRED: a
 * replay is the same act, and `addBarber`'s IS the new record's id.
 *
 * Whether a text is usable (blank, too long), a shop is listed or a period
 * holds is the system's question, not the wire's.
 */

/** A barber works at a handful of shops; a longer list is no list. */
const SHOPS_MAX = 50;

const invalid = (field: string) => Result.err(TeamError.invalidInput(field));

/** The verified caller, as the pipelines' gates read them. */
function callerOf(request: WireRequest): TeamCaller {
  return {
    callerUserId: callerUserId(request),
    callerRoles: callerKnownRoles(request),
  };
}

/** A shop day, `null` when sent as `null` or absent, else `undefined` (unreadable). */
function dayOrNull(
  payload: Payload,
  field: string,
): LocalDate | null | undefined {
  const raw = StoredFields.field(payload, field) ?? null;
  if (raw === null) return null;
  return idOf(raw, LocalDate.parse) ?? undefined;
}

/** An authored text, `null` when sent as `null` or absent, else `undefined` (unreadable). */
function textOrNone(
  payload: Payload,
  field: string,
): AuthoredText | null | undefined {
  const raw = StoredFields.field(payload, field) ?? null;
  if (raw === null) return null;
  return AuthoredText.read(raw) ?? undefined;
}

/** The shops as sent: an array of at most {@link SHOPS_MAX} location ids (`[]` is every shop), else `null`. */
function shopsOf(payload: Payload): readonly LocationId[] | null {
  const raw = StoredFields.field(payload, 'locationIds');
  return Array.isArray(raw) ? idsOf(raw, LocationId.parse, SHOPS_MAX) : null;
}

/** The record a call names and the act's name — the two fields every call but `addBarber` shares. */
function namedOf(
  payload: Payload,
): Result<
  { readonly barberId: BarberId; readonly operationId: OperationId },
  EdgeError
> {
  const barberId = idOf(
    StoredFields.field(payload, 'barberId'),
    BarberId.parse,
  );
  if (barberId === null) return invalid('barberId');
  const operationId = operationIdOf(payload, 'operationId');
  if (operationId === null) return invalid('operationId');
  return Result.ok({ barberId, operationId });
}

/**
 * `addBarber` `{ name: { bg, en }, locationIds: [], barberStartsLocalDate,
 * barberLastWorkingLocalDate: … | null, barberDraftTargetStatus:
 * 'STAFF_ONLY' | 'PUBLIC', barberJoinsAnyPool, operationId }` →
 * `{ barberId }`.
 */
export function decodeAddBarber(
  request: WireRequest,
): Result<AddBarberCommand, EdgeError> {
  const caller = callerOf(request);
  const admitted = admitTeamCaller(caller);
  if (!admitted.ok) return admitted;
  const payload = payloadOf(request);
  const name = AuthoredText.read(StoredFields.field(payload, 'name'));
  if (name === null) return invalid('name');
  const locationIds = shopsOf(payload);
  if (locationIds === null) return invalid('locationIds');
  const barberStartsLocalDate = idOf(
    StoredFields.field(payload, 'barberStartsLocalDate'),
    LocalDate.parse,
  );
  if (barberStartsLocalDate === null) return invalid('barberStartsLocalDate');
  const barberLastWorkingLocalDate = dayOrNull(
    payload,
    'barberLastWorkingLocalDate',
  );
  if (barberLastWorkingLocalDate === undefined) {
    return invalid('barberLastWorkingLocalDate');
  }
  const barberDraftTargetStatus = StoredFields.field(
    payload,
    'barberDraftTargetStatus',
  );
  if (!BarberLifecycle.isLiveStatus(barberDraftTargetStatus)) {
    return invalid('barberDraftTargetStatus');
  }
  const barberJoinsAnyPool = StoredFields.field(payload, 'barberJoinsAnyPool');
  if (typeof barberJoinsAnyPool !== 'boolean') {
    return invalid('barberJoinsAnyPool');
  }
  const operationId = operationIdOf(payload, 'operationId');
  if (operationId === null) return invalid('operationId');
  return Result.ok({
    ...caller,
    operationId,
    name,
    locationIds,
    barberStartsLocalDate,
    barberLastWorkingLocalDate,
    barberDraftTargetStatus,
    barberJoinsAnyPool,
  });
}

/** The part an `editBarber` payload replaces, read whole — or the first unreadable field. */
function editOf(
  barberEdit: BarberEdit,
  payload: Payload,
): Result<BarberEditRequest, EdgeError> {
  switch (barberEdit) {
    case BarberEdit.Profile: {
      const name = AuthoredText.read(StoredFields.field(payload, 'name'));
      if (name === null) return invalid('name');
      const title = textOrNone(payload, 'title');
      if (title === undefined) return invalid('title');
      const bio = textOrNone(payload, 'bio');
      if (bio === undefined) return invalid('bio');
      const instagramHandle =
        StoredFields.field(payload, 'instagramHandle') ?? null;
      if (instagramHandle !== null && typeof instagramHandle !== 'string') {
        return invalid('instagramHandle');
      }
      const yearsExperience =
        StoredFields.field(payload, 'yearsExperience') ?? null;
      if (yearsExperience !== null && typeof yearsExperience !== 'number') {
        return invalid('yearsExperience');
      }
      return Result.ok({
        barberEdit,
        name,
        title,
        bio,
        instagramHandle,
        yearsExperience,
      });
    }
    case BarberEdit.Shops: {
      const locationIds = shopsOf(payload);
      return locationIds === null
        ? invalid('locationIds')
        : Result.ok({ barberEdit, locationIds });
    }
    case BarberEdit.Period: {
      const barberStartsLocalDate = idOf(
        StoredFields.field(payload, 'barberStartsLocalDate'),
        LocalDate.parse,
      );
      if (barberStartsLocalDate === null) {
        return invalid('barberStartsLocalDate');
      }
      const barberLastWorkingLocalDate = dayOrNull(
        payload,
        'barberLastWorkingLocalDate',
      );
      return barberLastWorkingLocalDate === undefined
        ? invalid('barberLastWorkingLocalDate')
        : Result.ok({
            barberEdit,
            barberStartsLocalDate,
            barberLastWorkingLocalDate,
          });
    }
    case BarberEdit.Pool: {
      const barberJoinsAnyPool = StoredFields.field(
        payload,
        'barberJoinsAnyPool',
      );
      return typeof barberJoinsAnyPool === 'boolean'
        ? Result.ok({ barberEdit, barberJoinsAnyPool })
        : invalid('barberJoinsAnyPool');
    }
    case BarberEdit.Access: {
      const barberStatus = StoredFields.field(payload, 'barberStatus');
      return BarberLifecycle.isLiveStatus(barberStatus)
        ? Result.ok({ barberEdit, barberStatus })
        : invalid('barberStatus');
    }
  }
}

/**
 * `editBarber` `{ barberId, barberEdit: 'PROFILE' | 'SHOPS' | 'PERIOD' |
 * 'POOL' | 'ACCESS', …the part, operationId }` → `{ barberId }`. Any staff
 * token may ask for a profile; every other part is the team manager's.
 */
export function decodeEditBarber(
  request: WireRequest,
): Result<EditBarberCommand, EdgeError> {
  const caller = callerOf(request);
  const staff = admitTeamStaffCaller(caller);
  if (!staff.ok) return staff;
  const payload = payloadOf(request);
  const barberEdit = StoredFields.field(payload, 'barberEdit');
  if (!Tag.has(BarberEdit, barberEdit)) return invalid('barberEdit');
  if (
    barberEdit !== BarberEdit.Profile &&
    !Roles.managesTeam(caller.callerRoles)
  ) {
    return Result.err(TeamError.forbidden());
  }
  const named = namedOf(payload);
  if (!named.ok) return named;
  const edit = editOf(barberEdit, payload);
  if (!edit.ok) return edit;
  return Result.ok({ ...caller, ...named.value, ...edit.value });
}

/** `activateBarber` `{ barberId, operationId }` → `{ barberId, barberActivation, staffSetupItem? }` — any staff token. */
export function decodeActivateBarber(
  request: WireRequest,
): Result<ActivateBarberCommand, EdgeError> {
  const caller = callerOf(request);
  const admitted = admitTeamStaffCaller(caller);
  if (!admitted.ok) return admitted;
  const named = namedOf(payloadOf(request));
  return named.ok ? Result.ok({ ...caller, ...named.value }) : named;
}

/** `deleteDraftBarber` `{ barberId, operationId }` → `{ barberId }` — the team manager's. */
export function decodeDeleteDraftBarber(
  request: WireRequest,
): Result<DeleteDraftBarberCommand, EdgeError> {
  const caller = callerOf(request);
  const admitted = admitTeamCaller(caller);
  if (!admitted.ok) return admitted;
  const named = namedOf(payloadOf(request));
  return named.ok ? Result.ok({ ...caller, ...named.value }) : named;
}
