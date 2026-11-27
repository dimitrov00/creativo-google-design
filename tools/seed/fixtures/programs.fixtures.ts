/**
 * THE DEV SEED'S PROGRAMS (OR-41, DEP-F29 — flip 4 Q5's "no seed" taken
 * back): `positions/{id}`, `courses/{id}` and `events/{id}` as their flat
 * archetypes minus `id`, built as ENGINE OUTPUT. Each document is the admin
 * form an editor would type on `/admin/programs` (`PositionInput`,
 * `CourseInput`, `ShopEventInput`), judged by `ProgramsSystem` exactly as
 * the admin save judges it (`program-content.pipeline.ts`): an event's zone
 * picked by `ProgramsSystem.zoneOf` off the ONE shop that places it (its
 * own, else the default shop), its wall clock converted ONCE by
 * `ZonedTimeSystem.toUtc` (Law 7.3), the entity assembled by
 * `ProgramsSystem.shopEvent`. A form the app would refuse is a broken
 * fixture (`sure`), so it stops the seed before anything is written.
 *
 * The plan logic (`tools/seed/programs.mjs`) decides WHEN: the day each
 * event falls on, from the shop's today. Two roles (one open, one closed),
 * three courses (open, upcoming, closed) and two events (one ahead, one
 * behind), and ONE description (`positionBodies/{id}`): the open barber
 * role's, Markdown per language, as the editor will save it. The copy
 * speaks in the catalogue's «ти» voice (OR-51).
 */
import {
  EnrollmentStatus,
  ContactMethod,
  PositionStatus,
  WorkplaceMode,
  TenantConfig,
  type CourseInput,
  type PositionInput,
  type ShopEventInput,
} from '@core/components';
import type {
  Course,
  Position,
  PositionBody,
  ShopEvent,
  ShopLocation,
} from '@core/entities';
import {
  CourseId,
  EventId,
  type LocalDate,
  type LocationId,
  PositionId,
} from '@core/primitives';
import { ProgramsSystem, ZonedTimeSystem } from '@core/systems';
import {
  type Body,
  CENTER,
  LOCATIONS,
  type Seeded,
  sure,
  type Without,
} from './catalog.fixtures';

/** A program as the admin form types it: where it is stored (`id`) and the form (`input`). */
export type ProgramForm<Id, Input> = {
  readonly id: Id;
  readonly input: Input;
};

/**
 * An event's form without its day: the plan places it (`programs.mjs`),
 * and the form's `startsAt` is that day at `startTime` (`HH:mm`), exactly
 * as `<input type="datetime-local">` emits it.
 */
export type EventForm = {
  readonly id: EventId;
  readonly startTime: string;
  readonly input: Without<ShopEventInput, 'startsAt'>;
};

// ── Positions ──────────────────────────────────────────────────────────────

/** One open role at the Center shop, one closed one at every shop, one open remote one. */
export const POSITION_FORMS: readonly ProgramForm<PositionId, PositionInput>[] =
  [
    {
      id: PositionId.of('pos-barber'),
      input: {
        title: {
          bg: 'Бръснар — пълно работно време',
          en: 'Barber — full time',
        },
        summary: {
          bg: 'Пет дни в седмицата, в салона в Център. Покажи ни работата си — останалото ще изградим заедно.',
          en: "Five days a week at our Center shop. Show us your work — we'll build the rest together.",
        },
        workplaceMode: WorkplaceMode.OnSite,
        locationIds: [CENTER],
        positionStatus: PositionStatus.Open,
        contacts: [
          { contactMethod: ContactMethod.Phone, contactValue: '+359888123456' },
          {
            contactMethod: ContactMethod.Email,
            contactValue: 'jobs@creativo.example',
          },
          {
            contactMethod: ContactMethod.Instagram,
            contactValue: 'creativo.barbershop',
          },
        ],
        sortOrder: 0,
      },
    },
    {
      id: PositionId.of('pos-apprentice'),
      input: {
        title: { bg: 'Чирак бръснар', en: 'Apprentice barber' },
        summary: {
          bg: 'Учиш до опитен бръснар и поемаш първите си клиенти. В момента не набираме — следи тази страница.',
          en: "Learn beside a senior barber and take your first clients. We're not hiring right now — keep an eye on this page.",
        },
        workplaceMode: WorkplaceMode.OnSite,
        locationIds: [],
        positionStatus: PositionStatus.Closed,
        contacts: [],
        sortOrder: 1,
      },
    },
    {
      id: PositionId.of('pos-social'),
      input: {
        title: {
          bg: 'Социални мрежи и съдържание',
          en: 'Social media and content',
        },
        summary: {
          bg: 'Снимаш, монтираш и пишеш за салоните — от където и да си. Няколко часа седмично.',
          en: 'Shoot, edit and write for the shops — from wherever you are. A few hours a week.',
        },
        workplaceMode: WorkplaceMode.Remote,
        locationIds: [],
        positionStatus: PositionStatus.Open,
        contacts: [],
        sortOrder: 2,
      },
    },
  ];

// ── Courses ────────────────────────────────────────────────────────────────

/** Open, upcoming and closed — the public page lists the first two. */
export const COURSE_FORMS: readonly ProgramForm<CourseId, CourseInput>[] = [
  {
    id: CourseId.of('crs-fundamentals'),
    input: {
      title: { bg: 'Основи на бръснарството', en: 'Barbering fundamentals' },
      description: {
        bg: 'Шест вечери с ножицата, машинката и бръснача. Започваш от нулата и завършваш с първия си фейд.',
        en: 'Six evenings with scissors, clippers and the razor. Start from zero and finish with your first fade.',
      },
      enrollmentStatus: EnrollmentStatus.Open,
      startsLabel: { bg: 'Всеки месец', en: 'Every month' },
      contacts: [],
      sortOrder: 0,
    },
  },
  {
    id: CourseId.of('crs-fade-masterclass'),
    input: {
      title: { bg: 'Майсторски клас: фейд', en: 'Fade masterclass' },
      description: {
        bg: 'Един ден върху преходите — за бръснари, които вече работят с машинка.',
        en: 'One day on blends — for barbers who already work with clippers.',
      },
      enrollmentStatus: EnrollmentStatus.Upcoming,
      startsLabel: { bg: 'Пролет', en: 'Spring' },
      contacts: [],
      sortOrder: 1,
    },
  },
  {
    id: CourseId.of('crs-beard-razor'),
    input: {
      title: { bg: 'Брада и бръснач', en: 'Beard and razor' },
      description: {
        bg: 'Оформяне на брада и класическо бръснене с горещи кърпи. Следващото издание още не е обявено.',
        en: "Beard shaping and the classic hot-towel shave. The next run isn't announced yet.",
      },
      enrollmentStatus: EnrollmentStatus.Closed,
      startsLabel: { bg: '', en: '' },
      contacts: [],
      sortOrder: 2,
    },
  },
];

// ── Events ─────────────────────────────────────────────────────────────────

/** The open day ahead, at the Center shop. */
export const OPEN_STUDIO: EventForm = {
  id: EventId.of('evt-open-studio'),
  startTime: '18:00',
  input: {
    title: { bg: 'Ден на отворените врати', en: 'Open studio day' },
    description: {
      bg: 'Ела да се запознаеш с бръснарите, да разгледаш салона и да питаш каквото искаш. Не е нужно да запазваш час.',
      en: 'Come meet the barbers, look around the shop and ask anything. No booking needed.',
    },
    locationId: CENTER,
    contacts: [],
    sortOrder: 0,
  },
};

/** A night behind us, at no one shop — placed on the default shop's clock. */
export const CRAFT_NIGHT: EventForm = {
  id: EventId.of('evt-craft-night'),
  startTime: '19:30',
  input: {
    title: { bg: 'Вечер на занаята', en: 'Craft night' },
    description: {
      bg: 'Демонстрации, музика и разговори за занаята. Благодарим на всички, които дойдоха.',
      en: 'Demos, music and talk about the craft. Thanks to everyone who came.',
    },
    locationId: '',
    contacts: [],
    sortOrder: 0,
  },
};

// ── The engine ─────────────────────────────────────────────────────────────

// ── Bodies ─────────────────────────────────────────────────────────────────

/**
 * The open barber role's description — every construct of the subset but a
 * picture (pictures arrive with the upload): two heading levels, bold,
 * italic, a link, a bulleted and a numbered list, a quote.
 */
export const POSITION_BODIES: readonly PositionBody[] = [
  {
    id: PositionId.of('pos-barber'),
    body: {
      bg: [
        '# Какво ще правиш',
        '',
        'Стол в салона ни в **Център**, пет дни в седмицата. Клиентите идват със запазен час, така че работиш спокойно и довършваш всяка подстрижка както трябва.',
        '',
        '- Подстригване и *фейд* на машинка и ножица',
        '- Оформяне на брада и бръснене с бръснач',
        '- Съвет за поддръжка след всяко посещение',
        '',
        '## Какво търсим',
        '',
        '- Поне две години зад стола',
        '- Спокойна ръка и око за детайла',
        '- Желание да учиш — виж [курсовете ни](/courses)',
        '',
        '## Какво даваме',
        '',
        '- Пълен график от първия ден',
        '- Обучение с екипа всеки месец',
        '- Инструменти и продукти от салона',
        '',
        '> Покажи ни работата си — останалото ще изградим заедно.',
        '',
        '## Как да кандидатстваш',
        '',
        '1. Пиши ни или се обади',
        '2. Ела за пробен ден в салона',
        '3. Започваме заедно',
      ].join('\n'),
      en: [
        '# What you will do',
        '',
        'A chair at our **Center** shop, five days a week. Clients come with a booked time, so you work calmly and finish every cut properly.',
        '',
        '- Cuts and *fades* by clipper and scissor',
        '- Beard shaping and straight-razor shaves',
        '- Care advice after every visit',
        '',
        '## What we look for',
        '',
        '- At least two years behind the chair',
        '- A steady hand and an eye for detail',
        '- A wish to keep learning — see [our courses](/courses)',
        '',
        '## What we give',
        '',
        '- A full book from day one',
        '- Training with the team every month',
        '- Tools and products from the shop',
        '',
        "> Show us your work — we'll build the rest together.",
        '',
        '## How to apply',
        '',
        '1. Write to us or call',
        '2. Come in for a trial day',
        '3. We start together',
      ].join('\n'),
    },
  },
];

/** The description as its document stores it. */
export function positionBodyDocument(
  entity: PositionBody,
): Seeded<PositionId, PositionBody> {
  const { id, ...body } = entity;
  return { id, body: body satisfies Body<PositionBody> };
}

/** A seeded shop as `loadLocation` answers it — `null` when the seed holds none. */
function seededShop(id: LocationId): ShopLocation | null {
  const seeded = LOCATIONS.find((entry) => entry.id === id);
  return seeded === undefined ? null : { id: seeded.id, ...seeded.body };
}

/** The role the admin save would store for `form`. */
export function positionDocument(
  form: ProgramForm<PositionId, PositionInput>,
): Seeded<PositionId, Position> {
  const { id, ...body } = sure(
    ProgramsSystem.position(form.id, form.input),
    `position ${form.id}`,
  );
  return { id, body: body satisfies Body<Position> };
}

/** The course the admin save would store for `form`. */
export function courseDocument(
  form: ProgramForm<CourseId, CourseInput>,
): Seeded<CourseId, Course> {
  const { id, ...body } = sure(
    ProgramsSystem.course(form.id, form.input),
    `course ${form.id}`,
  );
  return { id, body: body satisfies Body<Course> };
}

/**
 * The event the admin save would store for `form` on `localDate`: its
 * fields judged, its zone off the ONE shop that places it (its own, else
 * the default shop — `TenantConfig.DEFAULT`), its instant converted once.
 */
export function shopEventDocument(
  form: EventForm,
  localDate: LocalDate,
): Seeded<EventId, ShopEvent> {
  const what = `event ${form.id} on ${localDate}`;
  const fields = sure(
    ProgramsSystem.eventFields({
      ...form.input,
      startsAt: `${localDate}T${form.startTime}`,
    }),
    what,
  );
  const { defaultLocationId } = TenantConfig.DEFAULT;
  const zone = sure(
    ProgramsSystem.zoneOf(
      fields.locationId,
      seededShop(ProgramsSystem.zoneLocationOf(fields, defaultLocationId)),
      defaultLocationId,
    ),
    what,
  );
  const utcEpochMs = sure(
    ZonedTimeSystem.toUtc(fields.localDate, fields.startMinutes, zone),
    what,
  );
  const { id, ...body } = ProgramsSystem.shopEvent(form.id, fields, utcEpochMs);
  return { id, body: body satisfies Body<ShopEvent> };
}
