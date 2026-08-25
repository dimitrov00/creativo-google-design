import { Injectable, computed, signal } from '@angular/core';

/**
 * Which facts an agenda card shows.
 *
 * ### Why this is a preference and not a design decision
 * A shop's schedule is read by people asking different questions of it. A
 * barber between cuts wants the next name and nothing else. A receptionist
 * fielding the phone wants the barber, the service and the number. An owner
 * closing the day wants price and totals. One fixed card serves whichever of
 * those the designer had in mind and taxes the other two on every glance.
 *
 * So the card's ANATOMY is fixed — the same slots in the same places, so the
 * run keeps its rhythm however it is configured — and only which slots are
 * filled is chosen.
 *
 * The client's PHONE is deliberately absent too, and that is a privacy
 * ruling rather than a layout one: this screen lies face-up on a counter and
 * gets turned toward whoever is standing at it. The number lives in the visit
 * sheet, which is opened on purpose. A field toggle would have made it a
 * setting somebody could switch on and forget.
 *
 * The start time is deliberately absent from this list: it is the agenda's
 * group heading, not a field, and a card that could hide it would be a card
 * that could not be placed.
 *
 * The BARBER has no photo field here at all. Their identity is the rail's
 * hue, and their name is one toggle away — which is exactly Apple's model
 * (colour on the row, the name off it). A face was tried twice: perched on
 * the rail it read as a lollipop nobody could name, and inline in the context
 * line it fought the design system's own avatar, which sizes itself and
 * refuses to be laid out as text. Two failures in one place is the design
 * telling you the element does not belong.
 *
 * `avatar` is the CLIENT's, and there is no client PHOTO anywhere in this
 * product, so it is their initials — still the fastest way to pick a name out
 * of a run.
 *
 * `barber` was here and is not a field any more. The card carries the
 * barber's own face in the trailing cluster and their chair's colour down
 * the rail — spelling the name out underneath was the same answer a third
 * time, in the one column whose premise is that each line is a fact you do
 * not already have.
 *
 * `end` and `status` were here and are not fields any more.
 *
 * `end` because the start is the group's own heading, 60px to the card's
 * left, and the duration is on the card — an end time is the sum of two
 * numbers already on screen, and it lives in the visit sheet in full.
 *
 * `status` because a switch that can hide "ОТКАЗАН" is not a preference, it
 * is a way to miss a cancellation. The word prints only for exceptions
 * anyway, so there was never an ordinary card it saved anything on.
 *
 * `relative` was here and is not a field any more. A toggle that turns "in 6
 * hours" on for row fourteen at the same time as it turns "in 10 minutes" on
 * for the next cut is not a preference — it is one rule stated as two, and
 * whichever way the reader sets it they are wrong half the time. The
 * component decides per row now: a countdown on the running cut and on the
 * next one, nothing anywhere else.
 */
export type AgendaFieldId =
  | 'avatar'
  | 'barberAvatar'
  | 'email'
  | 'phone'
  | 'service'
  | 'note'
  | 'timeStart'
  | 'timeEnd'
  | 'timeRelative'
  | 'price'
  | 'party'
  | 'freeTime';

/** Display order in the picker — the order the card itself stacks them. */
export const AGENDA_FIELDS: readonly AgendaFieldId[] = [
  'avatar',
  'barberAvatar',
  'email',
  'phone',
  'service',
  'note',
  'timeStart',
  'timeEnd',
  'timeRelative',
  'price',
  'party',
  'freeTime',
];

/**
 * The default card: who, with whom, for what, and in what state.
 *
 * Price is OFF by default even though it is the owner's first question,
 * because the schedule is read in front of clients far more often than it is
 * read alone — and a number beside a person's name is the one field on this
 * card that embarrasses a shop when the screen is turned around. It is one
 * toggle away for whoever wants it.
 */
const DEFAULTS: Readonly<Record<AgendaFieldId, boolean>> = {
  /** The client's disc, leading the body row, carrying `+N` when the
   *  booking is for more than one chair. */
  avatar: true,
  /** The barber's, at the far end of the same row — full size now, filled
   *  with their tone and carrying their initials. */
  barberAvatar: true,
  /**
   * THE CLIENT'S ADDRESS AND NUMBER, on the card.
   *
   * Both were deliberately absent: an earlier ruling held that this screen
   * lies face-up on a counter and gets turned toward whoever is standing at
   * it, so contact details belonged in the visit sheet, opened on purpose.
   * The owner has since asked for them in the run, and that is their call to
   * make about their own shop.
   *
   * They stay FIELDS rather than becoming fixtures, so a shop that shares the
   * counter with its clients can put them back behind the sheet with one tap.
   */
  email: true,
  phone: true,
  /** What the visit actually is. */
  service: true,
  /** Clamped to one line here; the sheet has it in full. */
  note: true,
  /**
   * THE INTERVAL, in three switches rather than one.
   *
   * It was a single `time` field covering the start, the end and the relative
   * gloss as a block, which is one rule where the reader has three questions.
   * A shop that never overruns wants the end; one that does wants it most;
   * a barber working from a phone between cuts wants "след 2 ч" and neither
   * clock. Bundling them meant losing all three to drop any one.
   *
   * The start stays on by default because it is the only one of the three
   * that cannot be inferred from anything else on the card.
   */
  timeStart: true,
  timeEnd: true,
  timeRelative: true,
  /** This screen is turned around in front of clients. */
  price: false,
  /** `+N` on the client's disc, not a row. */
  party: true,
  /**
   * FREE TIME — off.
   *
   * Every unsold minute is a card, and on the quiet Tuesday that is most of
   * a shop's week that means the run is mostly holes. The screen's job is the
   * bookings; the holes are a second question, asked when someone is actually
   * trying to fill one. The day's total free time is still stated in words
   * above the run, so turning this off never hides the FACT that the day was
   * quiet — only the row-by-row inventory of it.
   */
  freeTime: false,
};

const STORAGE_KEY = 'staff-agenda-fields';

function load(): Record<AgendaFieldId, boolean> {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Record<AgendaFieldId, boolean>>;
    // Merged over the defaults, never trusted wholesale: a stored blob from
    // an older build is missing whatever shipped since, and a card that hid
    // a field because it had not been invented yet reads as a bug.
    const next = { ...DEFAULTS };
    for (const id of AGENDA_FIELDS) {
      if (typeof parsed[id] === 'boolean') next[id] = parsed[id];
    }
    return next;
  } catch {
    // Corrupt storage is not worth a broken screen.
    return { ...DEFAULTS };
  }
}

/**
 * Per-DEVICE, not per-account, and deliberately so: the front-desk iPad and
 * a barber's phone are read by different people asking different questions,
 * and syncing one person's choice onto the shared screen would be the wrong
 * behaviour rather than a missing feature. Same reasoning — and the same
 * storage — as the theme.
 */
@Injectable({ providedIn: 'root' })
export class AgendaFields {
  private readonly state = signal<Record<AgendaFieldId, boolean>>(load());

  readonly visible = this.state.asReadonly();

  /** How many are on, for the picker's own subtitle. */
  readonly count = computed(
    () => AGENDA_FIELDS.filter((id) => this.state()[id]).length,
  );

  /**
   * Nothing has been changed from the defaults.
   *
   * Gates the reset control: an always-present "reset" on a screen nobody has
   * customised is a button that cannot do anything, sitting under a list of
   * switches and inviting a tap that changes nothing.
   */
  readonly isDefault = computed(() =>
    AGENDA_FIELDS.every((id) => this.state()[id] === DEFAULTS[id]),
  );

  isOn(id: AgendaFieldId): boolean {
    return this.state()[id];
  }

  toggle(id: AgendaFieldId): void {
    this.state.update((current) => {
      const next = { ...current, [id]: !current[id] };
      this.persist(next);
      return next;
    });
  }

  reset(): void {
    this.state.set({ ...DEFAULTS });
    this.persist(DEFAULTS);
  }

  private persist(value: Readonly<Record<AgendaFieldId, boolean>>): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Private mode, quota, a locked-down kiosk — the choice simply does
      // not outlive the session. Not worth failing the toggle over.
    }
  }
}
