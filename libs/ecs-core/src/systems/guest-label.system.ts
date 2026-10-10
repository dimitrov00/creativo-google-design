import { Party } from '../components/party.data';
import { SeatLabel } from '../components/seat-label.data';

/** Who a requested seat is for — the ONLY source of these strings. */
export const RequestedSubjectKind = {
  /** The booker, bound to the verified token — never to the payload. */
  Self: 'self',
  /** A person with an account of their own, carried by a staff edit or a move. */
  Companion: 'companion',
  /** Somebody with no account: their label is their identity on the wire. */
  Guest: 'guest',
} as const;
export type RequestedSubjectKind =
  (typeof RequestedSubjectKind)[keyof typeof RequestedSubjectKind];

/**
 * A requested seat's subject as the payload names it (`RequestedSeat.subject`,
 * `decide-booking.ts:76-99`). `guestKey` is the client's own name for a guest
 * (the cart's seat key, `guest-3`) so two DIFFERENT guests under one label
 * can be told apart; `null` (an older client, a staff path, a carried seat)
 * reads one label as one person. It is never stored.
 */
export type RequestedSubject =
  | { readonly kind: typeof RequestedSubjectKind.Self }
  | {
      readonly kind: typeof RequestedSubjectKind.Companion;
      readonly userId: string;
    }
  | {
      readonly kind: typeof RequestedSubjectKind.Guest;
      readonly label: string;
      readonly guestKey: string | null;
    };

/** The person key of the booker's own seat. */
const SELF_KEY = 'self';
const ACCOUNT_PREFIX = 'account:';
const GUEST_PREFIX = 'guest:';

/**
 * GuestLabelSystem — who a seat is, as people are COUNTED: one key per person
 * on the cart, whatever seats they hold (`decide-booking.ts:767-781`
 * `personKey`), the "one label, one guest" rule the commit refuses by
 * (`namedGuestsOf` + the party's `labelSharedByTwoGuests`), and the one
 * placeholder rule the flow names a new guest by (`booking-flow.store.ts:
 * 1477` `firstUnusedLabel`). One implementation for the web and functions.
 */
export const GuestLabelSystem = {
  /**
   * One key per person: `self`, `account:<uid>`, `guest:<label>` — a guest
   * by the label as it is STORED (trimmed, the way `SeatLabel` keeps it), so
   * « Иван» and «Иван» are the one person they will be on the appointment.
   * Only ever compared for equality.
   */
  personKeyOf(subject: RequestedSubject): string {
    switch (subject.kind) {
      case RequestedSubjectKind.Self:
        return SELF_KEY;
      case RequestedSubjectKind.Companion:
        return `${ACCOUNT_PREFIX}${subject.userId}`;
      case RequestedSubjectKind.Guest:
        return `${GUEST_PREFIX}${subject.label.trim()}`;
    }
  },

  /**
   * The guests a request tells apart, as the label rule reads them: each
   * seat of a guest the client NAMED (`guestKey`), under the label it will
   * be stored as. A seat with no key is read the way the label alone reads
   * it, and a label that is not one is refused by name later, so it has
   * nothing to share.
   */
  namedGuests(
    subjects: readonly RequestedSubject[],
  ): readonly Party.LabelledGuest[] {
    const guests: Party.LabelledGuest[] = [];
    for (let i = 0; i < subjects.length; i++) {
      const subject = subjects[i] as RequestedSubject;
      if (subject.kind !== RequestedSubjectKind.Guest) continue;
      if (subject.guestKey === null) continue;
      const label = SeatLabel.parse(subject.label);
      if (!label.ok) continue;
      guests.push({ key: subject.guestKey, label: label.value });
    }
    return guests;
  },

  /**
   * ONE LABEL, ONE GUEST: a label two different named guests share, or
   * `null` — the party's own rule (`Party.labelSharedByTwoGuests`), never a
   * copy of it.
   */
  sharedLabel(subjects: readonly RequestedSubject[]): SeatLabel | null {
    return Party.labelSharedByTwoGuests(GuestLabelSystem.namedGuests(subjects));
  },

  /**
   * `label(n)` for the first `n` counting up from `from` that is not in
   * `taken` — the ONE placeholder rule, for a prefilled party and a guest
   * added on the services step alike. NEVER a taken label (the party refuses
   * a guest under a label another guest holds): `taken` can block at most
   * `taken.length` ordinals, so one more try always lands — unless `label`
   * ignores its ordinal (a catalogue missing its `{{number}}`), when the
   * number is written after the word («Гост 2»), which the same pigeonhole
   * bound lands too. Labels compare trimmed, as they are stored.
   */
  firstUnusedLabel(
    taken: readonly string[],
    label: (ordinal: number) => string,
    from: number,
  ): string {
    const last = from + taken.length;
    for (let ordinal = from; ordinal <= last; ordinal++) {
      const candidate = label(ordinal).trim();
      if (!taken.includes(candidate)) return candidate;
    }
    let numbered = '';
    for (let ordinal = from; ordinal <= last; ordinal++) {
      numbered = `${label(ordinal).trim()} ${ordinal}`.trim();
      if (!taken.includes(numbered)) return numbered;
    }
    // Unreachable for a `label` that answers the same word for every ordinal;
    // a pathological one still returns rather than spinning.
    return numbered;
  },
} as const;
