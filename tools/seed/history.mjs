/**
 * Past visits for the dev seed: eighteen months of a small shop's book,
 * generated from per-client PLANS into the same fixtures the day's
 * hand-authored appointments use.
 *
 * Deterministic by construction — a seeded PRNG per client, day offsets
 * relative to the shop's today — so every run writes the same ids with the
 * same content, and a plan's counts (Георги's 23 visits) hold whatever the
 * date. Realistic where the screens can tell: each visit lands on a day and
 * inside a shift its barber actually works, never on top of another visit in
 * that chair nor inside its turnaround, for a service that barber sells and
 * at that barber's catalogue price, with the booking made before
 * the visit and the rebooking edge pointing at the visit it was made from.
 */
import { chairTerms, segmentsAt, turnaroundMinutesOf } from './catalog.mjs';
import { account, guest } from './appointments.mjs';

/** mulberry32 — small, fast, and the same sequence on every machine. */
export function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** FNV-1a, so a client's sequence depends on its id and nothing else. */
export function seedOf(text) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const between = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const pick = (rng, items) => items[Math.floor(rng() * items.length)];

/**
 * `count` day offsets walking BACK from `from`, each gap drawn from
 * `[minGap, maxGap]` days — a client's rhythm, oldest last.
 */
export function cadence(rng, { from, count, gap: [minGap, maxGap] }) {
  const offsets = [];
  let offset = from;
  for (let i = 0; i < count; i += 1) {
    offsets.push(offset);
    offset -= between(rng, minGap, maxGap);
  }
  return offsets;
}

const SLOT_STEP_MINUTES = 15;
/** How far a visit may slide off its planned day to find a worked shift. */
const DAY_SHIFTS = [0, -1, 1, -2, 2, -3, 3];

/**
 * Chairs already taken, per barber per day — so two generated visits never
 * share a chair, and a party's seats sit back to back.
 *
 * A taken block is padded by the barber's turnaround, as `commitBooking`
 * pads busy time before it places a seat: a visit the callable would refuse
 * for crowding the last client is not one the seed writes either. A party is
 * ONE block, so its own seats are never padded apart.
 */
export function createChairBook() {
  const taken = new Map();
  const key = (barberId, offset) => `${barberId}@${offset}`;
  return {
    isFree(barberId, offset, start, end) {
      const reset = turnaroundMinutesOf(barberId);
      return (taken.get(key(barberId, offset)) ?? []).every(
        ([from, to]) => end <= from - reset || start >= to + reset,
      );
    },
    take(barberId, offset, start, end) {
      const k = key(barberId, offset);
      taken.set(k, [...(taken.get(k) ?? []), [start, end]]);
    },
  };
}

/**
 * Where a visit fits: the first day of `offsets` on which every block of it
 * sits inside one bookable segment of its barber (roster ∩ shop hours ∩
 * exceptions), all at ONE shop — an appointment has one `locationId` — with
 * every chair free. On that day, the start nearest `preferredMinute` wins,
 * the earlier on a tie. `null` when no day of `offsets` holds it.
 *
 * `blocks` are chairs, in minutes from the visit's start, earliest first: a
 * lone visit is one block `[0, minutes)`; a party side by side is one block
 * per barber, each from 0; one barber's seats back to back are ONE block, so
 * a party is never padded apart in its own chair.
 */
export function placeVisit(
  calendar,
  book,
  { offsets, preferredMinute, blocks },
) {
  const [lead, ...others] = blocks;
  for (const offset of offsets) {
    const candidates = [];
    for (const segment of segmentsAt(lead.barberId, calendar, offset)) {
      for (
        let start = segment.startMinute - lead.from;
        start + lead.to <= segment.endMinute;
        start += SLOT_STEP_MINUTES
      ) {
        candidates.push({ start, locationId: segment.locationId });
      }
    }
    candidates.sort(
      (a, b) =>
        Math.abs(a.start - preferredMinute) -
          Math.abs(b.start - preferredMinute) || a.start - b.start,
    );
    const fits = ({ start, locationId }) =>
      others.every((block) =>
        segmentsAt(block.barberId, calendar, offset).some(
          (segment) =>
            segment.locationId === locationId &&
            segment.startMinute <= start + block.from &&
            start + block.to <= segment.endMinute,
        ),
      ) &&
      blocks.every((block) =>
        book.isFree(
          block.barberId,
          offset,
          start + block.from,
          start + block.to,
        ),
      );
    const free = candidates.find(fits);
    if (free) return { offset, ...free };
  }
  return null;
}

/** Marks a placed visit's chairs taken. */
export function takeVisit(book, { offset, start }, blocks) {
  for (const block of blocks) {
    book.take(block.barberId, offset, start + block.from, start + block.to);
  }
}

/**
 * The nearest worked day and free start for a block of `minutes` in one
 * barber's chair, strictly before today: the planned day first, then a day
 * either side; on each day, the start closest to the client's habitual hour
 * that fits inside one shift segment. `null` when three days either way hold
 * nothing.
 */
export function placeBlock(
  calendar,
  book,
  { barberId, plannedOffset, preferredMinute, minutes },
) {
  return placeVisit(calendar, book, {
    // History is strictly before today, whatever the shift.
    offsets: DAY_SHIFTS.map((shift) => plannedOffset + shift).filter(
      (offset) => offset < 0,
    ),
    preferredMinute,
    blocks: [{ barberId, from: 0, to: minutes }],
  });
}

const TIP_AMOUNTS = [100, 150, 200, 200, 300, 500];

/** Seat outcomes per visit outcome; companions share the visit's fate. */
function seatOutcome(visit) {
  switch (visit.outcome.kind) {
    case 'worked':
      return { kind: 'worked' };
    case 'no_show':
      return { kind: 'no_show' };
    case 'cancelled':
      return {
        kind: 'cancelled',
        by: visit.outcome.by,
        reason: { kind: visit.outcome.reason },
        hoursBefore: visit.outcome.hoursBefore,
      };
    default:
      throw new Error(`seed: unknown history outcome ${visit.outcome.kind}`);
  }
}

function rootStatus(visit) {
  switch (visit.outcome.kind) {
    case 'worked':
      return { kind: 'completed' };
    case 'no_show':
      return { kind: 'no_show' };
    default:
      // The root keeps the code the seats were stamped with, as the cancel
      // paths write it (`rootCancellationReason`).
      return { kind: 'cancelled', reason: visit.outcome.reason };
  }
}

/** A barber from the plan who sells every service of the chosen menu. */
function barberFor(rng, plan, menu) {
  const able = plan.barbers.filter((barberId) =>
    menu.every((item) => {
      try {
        chairTerms(item.serviceId, barberId, item.variantId ?? null);
        return true;
      } catch {
        return false;
      }
    }),
  );
  if (able.length === 0) {
    throw new Error(`seed: nobody in ${plan.uid}'s plan sells that menu`);
  }
  // A client who names their barber keeps them; "anyone" takes who is free.
  return plan.pref === 'specific' ? able[0] : pick(rng, able);
}

const minutesOf = (item, barberId) =>
  chairTerms(item.serviceId, barberId, item.variantId ?? null).durationMinutes;

/**
 * One client's history as appointment fixtures, oldest first.
 *
 * Booking provenance is drawn per visit: the client booked it themselves
 * (sometimes as «Запиши пак» from the last visit), or the shop did — on the
 * phone, or at the chair as the last visit ended, which is the rebooking
 * edge `bookedFromAppointmentId` exists to keep.
 */
export function historyForPlan(plan, profile, calendar, book) {
  const rng = prng(seedOf(plan.uid));
  const visits = plan
    .visits(rng)
    .slice()
    .sort((a, b) => a.offset - b.offset);
  const fixtures = [];
  let lastWorked = null;

  visits.forEach((visit, index) => {
    const id = `${plan.idPrefix}-${String(index + 1).padStart(2, '0')}`;
    const menu = pick(rng, plan.menus);
    const barberId = barberFor(rng, plan, menu);
    const companions = visit.companions ?? [];
    const items = [
      ...menu.map((item) => ({ ...item, subject: account(plan.uid, 'self') })),
      ...companions.map((companion) => ({
        serviceId: companion.serviceId,
        variantId: companion.variantId ?? null,
        subject:
          companion.userId === undefined
            ? guest(companion.label)
            : account(companion.userId, 'companion'),
      })),
    ];
    const minutes = items.reduce(
      (sum, item) => sum + minutesOf(item, barberId),
      0,
    );
    const placed = placeBlock(calendar, book, {
      barberId,
      plannedOffset: visit.offset,
      preferredMinute: plan.hour * 60 + (plan.minute ?? 0),
      minutes,
    });
    if (!placed) throw new Error(`seed: no chair for ${id}`);
    book.take(barberId, placed.offset, placed.start, placed.start + minutes);

    const outcome = seatOutcome(visit);
    const worked = outcome.kind === 'worked';
    let cursor = placed.start;
    const seats = items.map((item, seatIndex) => {
      const start = cursor;
      cursor += minutesOf(item, barberId);
      return {
        id: `${id}-s${seatIndex + 1}`,
        barberId,
        serviceId: item.serviceId,
        variantId: item.variantId ?? null,
        hour: Math.floor(start / 60),
        minute: start % 60,
        subject: item.subject,
        // Only the booker names a barber; a companion goes where they go.
        pref: seatIndex === 0 ? plan.pref : 'any',
        outcome,
        tipMinorUnits:
          worked && rng() < plan.tipRate ? pick(rng, TIP_AMOUNTS) : null,
      };
    });

    // Who put it in the book, and when.
    let placement = 'self';
    let bookedAt;
    let bookedFrom = null;
    if (rng() < plan.selfRate) {
      bookedAt = {
        dayOffset: placed.offset - between(rng, 2, 10),
        hour: between(rng, 19, 22),
        minute: pick(rng, [5, 20, 35, 50]),
      };
      // «Запиши пак» from the last visit's card (`/book?repeat`).
      if (lastWorked && rng() < 0.35) bookedFrom = lastWorked.id;
    } else if (lastWorked && rng() < 0.6) {
      placement = 'staff';
      // Rebooked at the chair as the last visit ended.
      bookedAt = { ...lastWorked.endsAt, minute: lastWorked.endsAt.minute + 3 };
      bookedFrom = lastWorked.id;
    } else {
      placement = 'staff';
      bookedAt = {
        dayOffset: placed.offset - between(rng, 1, 6),
        hour: between(rng, 10, 16),
        minute: pick(rng, [0, 10, 25, 40]),
      };
    }

    // Walked in a few minutes early — only a worked visit was walked into.
    const arrivedMinute = placed.start - between(rng, 2, 9);
    fixtures.push({
      id,
      dayOffset: placed.offset,
      locationId: placed.locationId,
      status: rootStatus(visit),
      placement,
      bookedAt,
      bookedFromAppointmentId: bookedFrom,
      arrivedAt: worked
        ? { hour: Math.floor(arrivedMinute / 60), minute: arrivedMinute % 60 }
        : null,
      contact: profile.contact,
      seats,
    });

    if (worked) {
      lastWorked = {
        id,
        endsAt: {
          dayOffset: placed.offset,
          hour: Math.floor(cursor / 60),
          minute: cursor % 60,
        },
      };
    }
  });
  return fixtures;
}
