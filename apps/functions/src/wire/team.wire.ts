import {
  AuthoredText,
  BarberEdit,
  type BarberEditRequest,
  BarberLifecycle,
  type BarberOffering,
  OfferingsEdit,
  type OfferingsRequest,
  type ServiceTermsInput,
  type VariantTerms,
} from '@core/components';
import { TeamError } from '@core/errors';
import {
  BarberId,
  LocalDate,
  LocationId,
  type OperationId,
  Result,
  ServiceId,
  StoredFields,
  Tag,
} from '@core/primitives';
import {
  type ActivateBarberCommand,
  type AddBarberCommand,
  admitTeamCaller,
  type DeleteDraftBarberCommand,
  type EditBarberCommand,
  type ListTeamCommand,
  type SetBarberOfferingsCommand,
  type TeamCaller,
} from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerKnownRoles, callerUserId } from '../lib/booking/caller-roles';
import {
  idOf,
  idsOf,
  isRecord,
  listOf,
  operationIdOf,
  type Payload,
  payloadOf,
  type WireRequest,
} from './wire-read';

/**
 * THE TEAM CALLABLES' WIRE (team onboarding D5, D6, D9, D10,
 * `docs/designs/team-onboarding.md`) — `addBarber`, `editBarber`,
 * `setBarberOfferings`, `activateBarber`, `deleteDraftBarber`. The caller
 * and their roles come off the VERIFIED token, never the payload, and the
 * token gate is asked before the payload is read (`TEAM_UNAUTHENTICATED`,
 * `ACCESS_NOT_STAFF`): any staff role, for every call. The token cannot
 * know what the owner lets a level do, so which staff member may make
 * which act is the pipeline's question, asked of the STORED account
 * against `settings/staffPermissions` (staff permissions P6). Every field is re-read
 * through its smart constructor or guard, the first unreadable one named
 * (`TEAM_INVALID_INPUT`). The act's name (`operationId`) is REQUIRED: a
 * replay is the same act, and `addBarber`'s IS the new record's id.
 *
 * Whether a text is usable (blank, too long), a shop is listed or a period
 * holds is the system's question, not the wire's.
 */

/** A barber works at a handful of shops; a longer list is no list. */
const SHOPS_MAX = 50;

/** A catalogue holds tens of services; a list longer than this is no list. */
const OFFERINGS_MAX = 200;

/** A service declares a handful of variants; an offering overrides at most this many. */
const OVERRIDES_MAX = 20;

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
 * token may ask; the pipeline judges the part against the owner's
 * permissions (`TEAM_PROFILES` for a profile, `TEAM_MANAGE` for the rest).
 */
export function decodeEditBarber(
  request: WireRequest,
): Result<EditBarberCommand, EdgeError> {
  const caller = callerOf(request);
  const staff = admitTeamCaller(caller);
  if (!staff.ok) return staff;
  const payload = payloadOf(request);
  const barberEdit = StoredFields.field(payload, 'barberEdit');
  if (!Tag.has(BarberEdit, barberEdit)) return invalid('barberEdit');
  const named = namedOf(payload);
  if (!named.ok) return named;
  const edit = editOf(barberEdit, payload);
  if (!edit.ok) return edit;
  return Result.ok({ ...caller, ...named.value, ...edit.value });
}

/** The five terms as typed — each a number, the currency a string — else `null`. The catalogue's guard judges the figures. */
function termsOf(raw: Payload): ServiceTermsInput | null {
  const priceCents = StoredFields.field(raw, 'priceCents');
  const currency = StoredFields.field(raw, 'currency');
  const durationMinutes = StoredFields.field(raw, 'durationMinutes');
  const setupMinutes = StoredFields.field(raw, 'setupMinutes');
  const cleanupMinutes = StoredFields.field(raw, 'cleanupMinutes');
  return typeof priceCents === 'number' &&
    typeof currency === 'string' &&
    typeof durationMinutes === 'number' &&
    typeof setupMinutes === 'number' &&
    typeof cleanupMinutes === 'number'
    ? { priceCents, currency, durationMinutes, setupMinutes, cleanupMinutes }
    : null;
}

/** An offering's per-variant overrides as sent — absent reads as none — else `null`. */
function overridesOf(raw: Payload): readonly VariantTerms.Input[] | null {
  const sent = listOf(raw, 'overrides');
  if (sent.length > OVERRIDES_MAX) return null;
  const overrides: VariantTerms.Input[] = [];
  for (const override of sent) {
    if (!isRecord(override)) return null;
    const variantId = StoredFields.field(override, 'variantId');
    const terms = termsOf(override);
    if (typeof variantId !== 'string' || terms === null) return null;
    overrides.push({ variantId, ...terms });
  }
  return overrides;
}

/** The typed list as sent: at most {@link OFFERINGS_MAX} flat entries, else `null`. */
function entriesOf(payload: Payload): readonly BarberOffering.Entry[] | null {
  const sent = StoredFields.field(payload, 'offerings');
  if (!Array.isArray(sent) || sent.length > OFFERINGS_MAX) return null;
  const entries: BarberOffering.Entry[] = [];
  for (const raw of sent as readonly unknown[]) {
    if (!isRecord(raw)) return null;
    const serviceId = idOf(
      StoredFields.field(raw, 'serviceId'),
      ServiceId.parse,
    );
    const terms = termsOf(raw);
    const overrides = overridesOf(raw);
    if (serviceId === null || terms === null || overrides === null) {
      return null;
    }
    entries.push({ serviceId, overrides, ...terms });
  }
  return entries;
}

/** The request half of a `setBarberOfferings` payload — or the first unreadable field. */
function offeringsOf(
  offeringsEdit: OfferingsEdit,
  payload: Payload,
): Result<OfferingsRequest, EdgeError> {
  if (offeringsEdit === OfferingsEdit.Set) {
    const offerings = entriesOf(payload);
    return offerings === null
      ? invalid('offerings')
      : Result.ok({ offeringsEdit, offerings });
  }
  const copyFromBarberId = idOf(
    StoredFields.field(payload, 'copyFromBarberId'),
    BarberId.parse,
  );
  return copyFromBarberId === null
    ? invalid('copyFromBarberId')
    : Result.ok({ offeringsEdit, copyFromBarberId });
}

/**
 * `setBarberOfferings` `{ barberId, offeringsEdit: 'SET', offerings:
 * [{ serviceId, priceCents, currency, durationMinutes, setupMinutes,
 * cleanupMinutes, overrides: [{ variantId, …terms }] }], operationId }` or
 * `{ barberId, offeringsEdit: 'COPY', copyFromBarberId, operationId }` →
 * `{ barberId }`. Who may set a barber's prices is the pipeline's
 * question (`TEAM_OFFERINGS`; by default the owner alone).
 */
export function decodeSetBarberOfferings(
  request: WireRequest,
): Result<SetBarberOfferingsCommand, EdgeError> {
  const caller = callerOf(request);
  const admitted = admitTeamCaller(caller);
  if (!admitted.ok) return admitted;
  const payload = payloadOf(request);
  const offeringsEdit = StoredFields.field(payload, 'offeringsEdit');
  if (!Tag.has(OfferingsEdit, offeringsEdit)) return invalid('offeringsEdit');
  const named = namedOf(payload);
  if (!named.ok) return named;
  const offerings = offeringsOf(offeringsEdit, payload);
  if (!offerings.ok) return offerings;
  return Result.ok({ ...caller, ...named.value, ...offerings.value });
}

/** `activateBarber` `{ barberId, operationId }` → `{ barberId, barberActivation, staffSetupItem? }` — any staff token. */
export function decodeActivateBarber(
  request: WireRequest,
): Result<ActivateBarberCommand, EdgeError> {
  const caller = callerOf(request);
  const admitted = admitTeamCaller(caller);
  if (!admitted.ok) return admitted;
  const named = namedOf(payloadOf(request));
  return named.ok ? Result.ok({ ...caller, ...named.value }) : named;
}

/** `deleteDraftBarber` `{ barberId, operationId }` → `{ barberId }` — any staff token; `TEAM_MANAGE` in the pipeline. */
export function decodeDeleteDraftBarber(
  request: WireRequest,
): Result<DeleteDraftBarberCommand, EdgeError> {
  const caller = callerOf(request);
  const admitted = admitTeamCaller(caller);
  if (!admitted.ok) return admitted;
  const named = namedOf(payloadOf(request));
  return named.ok ? Result.ok({ ...caller, ...named.value }) : named;
}

/**
 * `listTeam` `{}` → `{ members: [...] }` — any staff token; how much of
 * the list a caller sees is the pipeline's question. The call names
 * nothing: only the verified caller reaches the pipeline.
 */
export function decodeListTeam(
  request: WireRequest,
): Result<ListTeamCommand, EdgeError> {
  const caller = callerOf(request);
  const admitted = admitTeamCaller(caller);
  return admitted.ok ? Result.ok(caller) : admitted;
}
