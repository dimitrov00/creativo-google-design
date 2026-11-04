import {
  AppointmentId,
  BarberId,
  BookingStatus,
  LocalDate,
  ServiceId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  BookingLifecycle,
  CancellationReasonSet,
  E164,
  Email,
  Seat,
  type BookingContact,
} from '@core/components';
import type { Appointment } from '@core/entities';
import { ZonedTimeSystem, type SearchLabels } from '@core/systems';
import { appointmentFixture, seatFixture } from './appointment.fixtures';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  minute,
  unwrapOk,
} from './test-support';

/** The barbers of a generated window, and the names the labels give them. */
export const SEARCH_BARBERS: readonly { id: BarberId; name: string }[] = [
  { id: BarberId.of('b-ivan'), name: 'Иван' },
  { id: BarberId.of('b-niko'), name: 'Нико' },
  { id: BarberId.of('b-stefan'), name: 'Стефан' },
  { id: BarberId.of('b-nikolay'), name: 'Николай' },
];

/** The services of a generated window, and their names. */
export const SEARCH_SERVICES: readonly { id: ServiceId; name: string }[] = [
  { id: ServiceId.of('svc-classic-cut'), name: 'Класическо подстригване' },
  { id: ServiceId.of('svc-fade'), name: 'Фейд' },
  { id: ServiceId.of('svc-beard'), name: 'Оформяне на брада' },
  { id: ServiceId.of('svc-scissor'), name: 'Подстригване с ножица' },
];

const FIRST_NAMES = [
  'Георги',
  'Мартин',
  'Петър',
  'Иван',
  'Кирил',
  'Даниел',
  'Стоян',
];
const LAST_NAMES = [
  'Иванов',
  'Петров',
  'Илиев',
  'Димитров',
  'Тодоров',
  'Маринов',
];
const NOTES = ['Алергия към боя', 'Идва с баща си', 'Предпочита късо'];

const STATUS_WHEEL: readonly BookingStatus[] = [
  BookingStatus.Confirmed,
  BookingStatus.Confirmed,
  BookingStatus.Confirmed,
  BookingStatus.Completed,
  BookingStatus.Cancelled,
  BookingStatus.NoShow,
];

/** A small seeded generator (mulberry32): the same seed, the same window. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A generated window and the labels that name its ids. */
export type SearchWindowFixture = {
  readonly visits: readonly Appointment[];
  readonly labels: SearchLabels;
};

/**
 * `count` visits over the 60 days before and the 60 after `FIXTURE_TODAY`,
 * spread over four barbers, four services and every status, most with a
 * contact name, a Bulgarian mobile number, some with a mail or a note —
 * seeded, so a spec and the dev seed see the same window. The contact name
 * is the only client label (the labels give no companion).
 */
export function searchWindowFixture(
  count: number,
  seed = 1,
): SearchWindowFixture {
  const next = randomFrom(seed);
  const pick = <T>(list: readonly T[]): T =>
    list[Math.floor(next() * list.length)] as T;
  const visits: Appointment[] = [];
  for (let i = 0; i < count; i++) {
    const barber = pick(SEARCH_BARBERS);
    const service = pick(SEARCH_SERVICES);
    const status = pick(STATUS_WHEEL);
    const localDate = LocalDate.addDays(
      FIXTURE_TODAY,
      Math.floor(next() * 121) - 60,
    );
    const startMinutes = minute(540 + 15 * Math.floor(next() * 32));
    const seat = seatFixture({
      barberId: barber.id,
      serviceId: service.id,
      startMinutes,
    });
    const utcEpochMs = unwrapOk(
      ZonedTimeSystem.toUtc(localDate, startMinutes, FIXTURE_TIME_ZONE),
    );
    const phone = `+3598${String(Math.floor(next() * 100_000_000)).padStart(8, '0')}`;
    const withMail = next() < 0.4;
    const withNote = next() < 0.25;
    const contact: Partial<BookingContact> = {
      contactName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      contactPhone: unwrapOk(E164.parse(phone)),
      contactEmail: withMail ? Email.of(`client${i}@example.test`) : null,
      contactNote: withNote ? pick(NOTES) : null,
    };
    visits.push(
      appointmentFixture({
        id: AppointmentId.of(`fx-${seed}-${i}`),
        seats: [seat],
        barberIds: [barber.id],
        localDate,
        startMinutes,
        endMinutes: Seat.endMinutes(seat),
        utcEpochMs,
        lifecycle: lifecycleOf(status, utcEpochMs),
        ...contact,
      }),
    );
  }
  return { visits, labels: SEARCH_LABELS };
}

function lifecycleOf(status: BookingStatus, at: UtcEpochMs): BookingLifecycle {
  switch (status) {
    case BookingStatus.Completed:
      return BookingLifecycle.complete(at);
    case BookingStatus.Cancelled:
      return BookingLifecycle.cancel(at, CancellationReasonSet.of([]));
    case BookingStatus.NoShow:
      return BookingLifecycle.noShow(at);
    default:
      return BookingLifecycle.confirm(FIXTURE_NOW_UTC_MS);
  }
}

/** The labels of {@link searchWindowFixture}: the contact name, the catalogue names. */
export const SEARCH_LABELS: SearchLabels = {
  clientNames: (visit) =>
    visit.contactName === null ? [] : [visit.contactName],
  serviceName: (id) => SEARCH_SERVICES.find((s) => s.id === id)?.name ?? null,
  barberName: (id) => SEARCH_BARBERS.find((b) => b.id === id)?.name ?? null,
};
