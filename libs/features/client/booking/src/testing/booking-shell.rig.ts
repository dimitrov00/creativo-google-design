/**
 * TEST SUPPORT for the booking flow's specs — never part of the lib's build
 * (`tsconfig.lib.json` excludes `src/testing/**`).
 *
 * The ports every rendered booking surface reads, bound to the
 * `@core/testing` doubles: the session, the profile, the catalogue's media,
 * the shop zone (a default location in the fixture zone), the pinned clock,
 * an id source the server's charset takes, a callable client that answers
 * nothing it was not scripted for, and the production `sessionStorage`
 * draft adapter, which round-trips the flat `BookingDraft` the way a tab
 * does. A spec adds what
 * it is about on top (later providers win): its catalogue, its day
 * documents, its visit, its server answers.
 */
import {
  type EnvironmentProviders,
  Injectable,
  InjectionToken,
  type Provider,
  inject,
} from '@angular/core';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { BehaviorSubject, type Observable, of } from 'rxjs';
import {
  APPOINTMENT_READ_PORTS,
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  BOOKING_DRAFT_PORTS,
  CLOCK_PORTS,
  DEFAULT_LOCATION_PORTS,
  GATEWAY_PORTS,
  ID_PORTS,
  LOCATION_LOAD_PORTS,
  MEDIA_RESOLVE_PORTS,
  PROFILE_PORTS,
  WAITLIST_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { sessionStorageBookingDraftPorts } from '@creativo/infrastructure/web-storage';
import { Principal } from '@core/components';
import type { Appointment, WaitlistRequest } from '@core/entities';
import type { GatewayPorts, IdPorts, LocationLoadPorts } from '@core/ports';
import { Result, UserId, type UtcEpochMs } from '@core/primitives';
import {
  locationFixture,
  memoryAppointmentReadPorts,
  memoryAuthSessionPorts,
  memoryAvatarPorts,
  memoryClockPorts,
  memoryDefaultLocationPorts,
  memoryMediaResolvePorts,
  memoryProfilePorts,
  memoryWaitlistReadPorts,
  principalFixture,
  scriptedGatewayPorts,
  utcMs,
} from '@core/testing';

/**
 * The booking specs' "now": Monday 2026-08-03, 09:00 in the shop's zone.
 * Pinned, so no spec changes meaning at midnight.
 */
export const BOOKING_NOW: UtcEpochMs = utcMs('2026-08-03T09:00:00.000+03:00');

/**
 * Client operation ids the server's charset takes (`[A-Za-z0-9_-]{16,64}`),
 * one per mint, in order.
 */
export function attemptIds(): IdPorts {
  let minted = 0;
  return {
    nextId: () => `attempt-${String(++minted).padStart(16, '0')}`,
  };
}

/**
 * Any shop the zone asks after, in the fixture zone — the default location
 * included, so `ShopZoneService.defaultZone()` answers `FIXTURE_TIME_ZONE`.
 */
export function fixtureLocationPorts(): LocationLoadPorts {
  return {
    loadLocation: async (id) => Result.ok(locationFixture({ id })),
  };
}

/** Signed in as `uid`, onboarded — the state every deep-link landing waits for. */
export function signedIn(uid: string): Principal {
  return principalFixture.client(UserId.of(uid));
}

/** What a rendered booking surface is given beyond the defaults. */
export interface BookingPortsOptions {
  /** Who is signed in; the anonymous visitor by default. */
  readonly principal?: Principal;
  /** The visits the owner-scoped reads answer. None by default. */
  readonly visits?: readonly Appointment[];
  /** The waitlist requests the owner-scoped read answers. None by default. */
  readonly waitlists?: readonly WaitlistRequest[];
  /** The callables. Each one not scripted fails `PIPELINE_UNKNOWN`. */
  readonly gateway?: GatewayPorts;
}

/** Every port a rendered booking surface reads, bound to its double. */
export function bookingPortProviders(
  options: BookingPortsOptions = {},
): Provider[] {
  return [
    // The production adapter over the jsdom `sessionStorage`: a remount over
    // the same storage is what a reload does; `sessionStorage.clear()` is a
    // new tab.
    {
      provide: BOOKING_DRAFT_PORTS,
      useFactory: sessionStorageBookingDraftPorts,
    },
    // Fixed, not the system clock: today, the lead time and the lapsed
    // days of a restored draft all read it.
    { provide: CLOCK_PORTS, useValue: memoryClockPorts(BOOKING_NOW) },
    { provide: ID_PORTS, useValue: attemptIds() },
    {
      provide: GATEWAY_PORTS,
      useValue: options.gateway ?? scriptedGatewayPorts(),
    },
    {
      provide: APPOINTMENT_READ_PORTS,
      useValue: memoryAppointmentReadPorts(options.visits ?? []),
    },
    {
      provide: WAITLIST_READ_PORTS,
      useValue: memoryWaitlistReadPorts(options.waitlists ?? []),
    },
    {
      provide: AUTH_SESSION_PORTS,
      useValue: memoryAuthSessionPorts({
        principals$: new BehaviorSubject<Principal>(
          options.principal ?? Principal.anonymous(),
        ),
      }),
    },
    { provide: PROFILE_PORTS, useValue: memoryProfilePorts(new Map()) },
    { provide: AVATAR_PORTS, useValue: memoryAvatarPorts() },
    { provide: MEDIA_RESOLVE_PORTS, useValue: memoryMediaResolvePorts() },
    { provide: LOCATION_LOAD_PORTS, useValue: fixtureLocationPorts() },
    { provide: DEFAULT_LOCATION_PORTS, useValue: memoryDefaultLocationPorts() },
  ];
}

/** The copy the active catalogue serves — every other key answers as itself. */
const TEST_COPY = new InjectionToken<Translation>('TEST_COPY');

@Injectable()
class InlineTranslationLoader implements TranslocoLoader {
  private readonly copy = inject(TEST_COPY);

  getTranslation(): Observable<Translation> {
    return of(this.copy);
  }
}

/** The copy a spec reads, served as the active catalogue (`bg`). */
export function provideBookingTestI18n(
  copy: Translation = {},
): (Provider | EnvironmentProviders)[] {
  return [
    { provide: TEST_COPY, useValue: copy },
    ...provideTransloco({
      config: {
        availableLangs: ['bg', 'en'],
        defaultLang: 'bg',
        fallbackLang: 'bg',
        missingHandler: { logMissingKey: false },
      },
      loader: InlineTranslationLoader,
    }),
  ];
}
