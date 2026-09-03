import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  UiAvatar,
  UiBadge,
  type UiBadgeTone,
  UiButton,
  UiChip,
  UiIcon,
  UiTextField,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import {
  UiCalendarGrid,
  UiListGroup,
  UiListRow,
  UiMenu,
  UiMenuItem,
  UiMenuTrigger,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import {
  type GridColumn,
  type GridCommit,
  type GridDraft,
  type GridDragCopy,
  type GridEvent,
  type GridWindow,
  StaffTimeGrid,
} from '../time-grid/staff-time-grid';

/* ────────────────────────────────────────────────────────────────────────
 * THE INPUT CONTRACT
 *
 * A view model, not a domain object. The editor draws a visit and edits a
 * DRAFT of it; the mapping from `Appointment` (seats, terms, ZonedDateTime)
 * to these flat, already-formatted fields belongs to the surface that owns
 * the store, and keeping it there is what lets this component be rendered
 * from a spec with a literal.
 * ──────────────────────────────────────────────────────────────────────── */

/** One sold service inside the visit — a seat, in the domain's vocabulary. */
export interface VisitEditorLeg {
  readonly seatId: string;
  readonly serviceLabel: string;
  readonly minutes: number;
  readonly priceLabel: string | null;
  readonly barberId: string;
  readonly barberName: string;
  readonly barberTone: number;
}

/** One status transition the graph currently allows, already named. */
export interface VisitEditorVerb {
  /** The `AppointmentStatusKind` the callable is asked for. */
  readonly kind: string;
  /** Translated — `Дойде`, `Готово`, `Не дойде`, `Откажи`. */
  readonly label: string;
  /** Cancelling asks a question first; the others do not. */
  readonly destructive: boolean;
}

/** A finished drag, named by the gesture the barber actually performed. */
export type VisitEditorCommit =
  | { readonly kind: 'move'; readonly startMinute: number }
  | {
      readonly kind: 'resize';
      readonly edge: 'start' | 'end';
      readonly startMinute: number;
      readonly endMinute: number;
    };

export interface VisitEditorVm {
  readonly appointmentId: string;
  readonly dayKey: string;
  /** Already localized — `вт, 26 авг`. */
  readonly dayLabel: string;
  /** Minutes from midnight. */
  readonly startMinute: number;
  readonly endMinute: number;
  readonly legs: readonly VisitEditorLeg[];
  readonly clientLabel: string;
  readonly phone: string | null;
  readonly phoneHref: string | null;
  /** `Нов` · `посл. 3 авг` — the shop's one fact about this person. */
  readonly clientMeta: string | null;
  /** The CLIENT's own note. Read-only, always — overwriting it destroys evidence. */
  readonly note: string | null;
  /** The visit subtotal, already through `formatMoney`. */
  readonly priceLabel: string | null;
  readonly status: string;
  readonly statusLabel: string;
  /** The chair the frame draws. */
  readonly chairName: string;
  readonly chairTone: number;
  readonly neighbours: readonly {
    name: string;
    startMinute: number;
    endMinute: number;
    tone: number;
  }[];
  readonly rosterStartMinute: number;
  readonly rosterEndMinute: number;
  readonly nowMinute: number | null;
  /**
   * The ONE verb the dock leads with, or `null` on a settled visit.
   *
   * These are **Regime A** — they write immediately, through
   * `transitionAppointment`, which ships. They are not part of the draft and
   * they are not waiting on `staffEditAppointment`; an editor that dropped
   * them would take away the only thing this sheet can currently do.
   */
  readonly primaryVerb: VisitEditorVerb | null;
  /** Everything else the graph allows — the `⋯` menu. */
  readonly overflowVerbs: readonly VisitEditorVerb[];
  /** A transition is in flight; the dock spins rather than double-firing. */
  readonly acting: boolean;
}

/**
 * One catalogue row for the pushed add-service page.
 *
 * A second input rather than an injected `CatalogReader`: the visit VM is
 * the appointment, and the catalogue is the shop. Threading it as data keeps
 * this component free of a port it would otherwise have to stub in every
 * test, and the owner of the store already holds the catalogue.
 */
export interface VisitEditorServiceOption {
  readonly id: string;
  readonly label: string;
  readonly minutes: number;
  readonly priceLabel: string | null;
}

/** One person for the pushed add-client page. */
export interface VisitEditorClientOption {
  readonly id: string;
  readonly label: string;
  readonly phone: string | null;
  readonly phoneHref: string | null;
  readonly meta: string | null;
}

/* ── The draft ─────────────────────────────────────────────────────────── */

/**
 * A leg in the draft.
 *
 * Identical to the input shape today, and named separately on purpose: the
 * draft is the thing being edited and the VM is the thing that arrived, and
 * collapsing the two is how an edit starts leaking back into its own source.
 */
type DraftLeg = VisitEditorLeg;

interface DraftClient {
  readonly id: string;
  readonly label: string;
  readonly phone: string | null;
  readonly phoneHref: string | null;
  readonly meta: string | null;
}

interface VisitDraft {
  readonly dayKey: string;
  readonly dayLabel: string;
  readonly startMinute: number;
  /**
   * `null` means "the duration is the services' summed span" — the invariant
   * that makes a leg's duration edit move the end for free. A menu pick or a
   * span that never matched the catalogue pins a number here instead.
   */
  readonly durationOverride: number | null;
  readonly legs: readonly DraftLeg[];
  readonly clients: readonly DraftClient[];
  /** The STAFF note. The client's is on the VM and is never merged with it. */
  readonly note: string | null;
  readonly promoLabel: string | null;
}

/** Which page is presented on top of the ladder. Depth is exactly one. */
type EditorPageKind =
  'service' | 'serviceSearch' | 'client' | 'clientSearch' | 'promo';

interface EditorPage {
  readonly kind: EditorPageKind;
  /** The leg or client the page is about, when it is about one. */
  readonly subjectId: string | null;
  /** The row that opened it — focus goes back there on pop (WCAG 3.2.2). */
  readonly originTestId: string | null;
}

/**
 * Status → badge tone.
 *
 * The same five rows `staff-dashboard.ts` keeps in its own `STATUS_TONES`,
 * and deliberately the same reasoning: `confirmed` and `completed` stay
 * NEUTRAL because nine visits in ten are one of them, and a colour that
 * means "ordinary" means nothing. The map is module-private over there, so
 * it cannot be imported today — it belongs in a shared module the moment the
 * dashboard wires this component, and that is a one-line move, not a rewrite.
 */
const STATUS_TONES = new Map<string, UiBadgeTone>([
  ['pending', 'warning'],
  ['confirmed', 'neutral'],
  ['completed', 'neutral'],
  ['cancelled', 'destructive'],
  ['no_show', 'destructive'],
]);

/** A chair the picker offers — the shop's roster, not this visit's. */
export interface VisitEditorBarberOption {
  readonly id: string;
  readonly label: string;
  readonly tone: number;
  /**
   * ⚠ The PORTRAIT, and it is the reason barbers wore monograms here.
   *
   * `ui-avatar` draws initials whenever `uiSrc` is absent — it is a fallback,
   * not an error — so a face-shaped control with no `src` fails silently and
   * looks deliberate. The scope switcher in the toolbar has always passed
   * `[uiSrc]="option.avatarSrc"`; this surface passed only `[uiName]`.
   */
  readonly avatarSrc: string | null;
}

/**
 * A barber as a PARTICIPANT — one token at the top of the sheet.
 *
 * Derived, never stored: a visit has no barber of its own, it has legs, and
 * each leg is worked by someone. Two legs worked by one barber are one
 * participant with two services named on the line under him.
 */
interface EditorBarberRow {
  readonly id: string;
  readonly label: string;
  readonly tone: number;
  readonly avatarSrc: string | null;
}

/**
 * THE CHAIR'S SHIFT, or `null` when the roster cannot say.
 *
 * One reading, shared by the window, the closed-hour shading and the
 * outside-the-shift verdict, because three different readings of the same
 * two numbers is how a frame ends up drawn shut over a visit it is happily
 * editing. `null` means "no usable shift": an end at or below the start,
 * which is what a shift closing at midnight becomes when it is read as a
 * wall-clock minute without being anchored to the day.
 */
function shiftOf(
  vm: VisitEditorVm,
): { startMinute: number; endMinute: number } | null {
  return vm.rosterEndMinute > vm.rosterStartMinute
    ? { startMinute: vm.rosterStartMinute, endMinute: vm.rosterEndMinute }
    : null;
}

/** The booking increment. Every authored time on this surface lands on it. */
const GRAIN_MINUTES = 5;
const DAY_MINUTES = 1440;
/**
 * The lengths a barbershop books whatever the catalogue says.
 *
 * Three, not six: the ruling is *"union the shop's two or three most-booked
 * lengths"*, and every extra row buys a duplicate of a rung the S±2g band
 * already covers. They are a stated default until the histogram that should
 * produce them exists — and when it does, this constant is what it replaces.
 */
const COMMON_MINUTES = [30, 45, 60] as const;
/** Beyond eight rows a menu stops being a menu (HIG). */
const LADDER_CAP = 8;

/** One row of a duration menu: the value, and the end it yields. */
interface DurationStep {
  readonly minutes: number;
  readonly endLabel: string;
  readonly isCatalogSum: boolean;
}

/**
 * The ladder IS the stepper, spelled as choices.
 *
 * Two grains either side of the catalogue span, unioned with the lengths the
 * shop books anyway, deduped, sorted and capped. The stepper literature
 * wants a dominant value with small deviations either side, which is exactly
 * what this emits — and it gets there with a menu of named outcomes instead
 * of bending `ui-stepper`, which is a `role="progressbar"` journey component
 * and not a numeric `±`.
 */
function ladderFor(span: number, startMinute: number): readonly DurationStep[] {
  const sum = Math.max(span, GRAIN_MINUTES);
  const picked = new Set<number>(
    [
      sum - 2 * GRAIN_MINUTES,
      sum - GRAIN_MINUTES,
      sum,
      sum + GRAIN_MINUTES,
      sum + 2 * GRAIN_MINUTES,
    ].filter((minutes) => minutes >= GRAIN_MINUTES),
  );
  for (const minutes of COMMON_MINUTES) {
    if (picked.size >= LADDER_CAP) break;
    picked.add(minutes);
  }
  return [...picked]
    .sort((a, b) => a - b)
    .map((minutes) => ({
      minutes,
      endLabel: clockLabel(startMinute + minutes),
      isCatalogSum: minutes === sum,
    }));
}

function clockLabel(minute: number): string {
  const wrapped = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = Math.floor(wrapped / 60);
  return `${String(hour).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function snap(minute: number): number {
  return Math.round(minute / GRAIN_MINUTES) * GRAIN_MINUTES;
}

function seedDraft(vm: VisitEditorVm): VisitDraft {
  const legs = vm.legs.map<DraftLeg>((leg) => ({ ...leg }));
  const sum = legs.reduce((total, leg) => total + leg.minutes, 0);
  const span = vm.endMinute - vm.startMinute;
  return {
    dayKey: vm.dayKey,
    dayLabel: vm.dayLabel,
    startMinute: vm.startMinute,
    // Only pin a number when the booked span never was the catalogue's.
    durationOverride: span === sum ? null : span,
    legs,
    clients: [
      {
        id: 'primary',
        label: vm.clientLabel,
        phone: vm.phone,
        phoneHref: vm.phoneHref,
        meta: vm.clientMeta,
      },
    ],
    note: null,
    promoLabel: null,
  };
}

/**
 * THE VISIT EDITOR — one sheet, one draft, one commit boundary.
 *
 * ### The shape, in one paragraph
 * A `ui-modal-sheet` with a static title (`Час`), a pinned summary strip that
 * never scrolls away, and a ladder that runs **day → picture → clock**: the
 * `Ден` row whose calendar expands as the next segment of its own list group,
 * a 100-minute close-up of the chair's day, then `Начало` and `Времетраене` —
 * the two facts a barber actually authors, from which the end time is
 * computed and stored nowhere. Below that: services, clients, money, notes,
 * each a chromeless `ui-list-group` with no eyebrow over it.
 *
 * ### One navigation stack, depth exactly one
 * A row that owns SEVERAL values travels (`›`); a value with a spatial editor
 * of its own expands in place (`⌄`). The service, the two searches and the
 * promo are pages inside THIS sheet — one scrim, one focus trap, one commit —
 * not sheets on top of a sheet. `‹` pops, Escape pops the child and only
 * closes at root, and there is no `Готово` on a child: the HIG's own reason
 * is that a second commit-shaped control is the one people mistake for the
 * dismiss.
 *
 * ### Nothing here reaches the server
 * `staffEditAppointment` does not exist. Every edit mutates the local draft
 * and the dock says so in a sentence rather than offering a `Запази` that
 * cannot save — the same construction R8 specifies for offline, and for the
 * same reason: a disabled promise is worse than an honest refusal.
 *
 * ### Two DS gaps, named rather than worked around
 * `ui-modal-sheet` has no `[sheet-action]` slot and `ui-sheet-header` has no
 * `[uiLeading]` slot, so the `⋯` and the child page's `‹` ride at the two
 * ends of the PINNED `[sheet-accessory]` strip instead of in the header bar.
 * They stay in the sticky chrome, which is the property that mattered; when
 * the two slots land, both controls move up one row and nothing else changes.
 * The shell's own `✕` keeps its place and POPS while a child is presented —
 * it is labelled `Назад` there, so it announces as what it does.
 */
@Component({
  selector: 'lib-staff-visit-editor',
  imports: [
    StaffTimeGrid,
    TranslocoDirective,
    UiAvatar,
    UiBadge,
    UiButton,
    UiCalendarGrid,
    UiChip,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiMenu,
    UiMenuItem,
    UiMenuTrigger,
    UiRadiusDirective,
    UiSheetActionBar,
    UiStack,
    UiTextDirective,
    UiTextField,
    UiVisuallyHiddenDirective,
    UiWeightDirective,
  ],
  templateUrl: './staff-visit-editor.html',
  styleUrl: './staff-visit-editor.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every surface in this feature: the `.staff-*` classes are
  // the styling contract and several of them dress projected DS content.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'staff-visit',
    'data-testid': 'staff-visit-editor',
    '[attr.data-depth]': 'depth()',
    '[attr.data-dirty]': "dirty() ? '' : null",
  },
})
export class StaffVisitEditor {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly transloco = inject(TranslocoService);

  readonly vm = input.required<VisitEditorVm>();
  /** The shop's catalogue, for the pushed add-service page. */
  readonly uiServices = input<readonly VisitEditorServiceOption[]>([]);
  /** Known people, for the pushed add-client page. */
  readonly uiClients = input<readonly VisitEditorClientOption[]>([]);
  /** The shop's chairs, for the barber combobox. */
  readonly uiBarbers = input<readonly VisitEditorBarberOption[]>([]);
  /** The sheet asked to close AT ROOT. A child pops and never emits this. */
  readonly dismissed = output<void>();

  /** A status transition the parent performs — never a draft edit. */
  readonly acted = output<string>();

  /**
   * A finished geometry gesture, in the editor's own vocabulary.
   *
   * Minutes-from-midnight rather than an ISO instant: the editor knows the
   * day only as a key and must not invent a zone to build a timestamp from.
   * The dashboard owns the clock and does that conversion, which is also the
   * only place that knows which shop calendar the day belongs to.
   */
  readonly committed = output<VisitEditorCommit>();

  constructor() {
    this.resolveDragCopy();
  }

  /**
   * The draft, reseeded only when the SUBJECT changes.
   *
   * `source` is the appointment id and the computation reads the VM
   * untracked, so a store push that re-renders the same appointment does not
   * throw away what the barber has typed.
   */
  protected readonly draft = linkedSignal<string, VisitDraft>({
    source: () => this.vm().appointmentId,
    computation: () => seedDraft(untracked(() => this.vm())),
  });

  private readonly seed = computed(() => seedDraft(this.vm()));
  protected readonly dirty = computed(
    () => JSON.stringify(this.draft()) !== JSON.stringify(this.seed()),
  );

  /* ── Disclosure and menu state ─────────────────────────────────────── */

  protected readonly dayOpen = signal(false);
  protected readonly durationMenu = signal(false);
  protected readonly legDurationMenu = signal(false);
  protected readonly legBarberMenu = signal(false);
  protected readonly moreMenu = signal(false);
  protected readonly noteOpen = signal(false);
  protected readonly query = signal('');
  /**
   * The decoupling line fires ONCE, on the first duration edit, and then
   * never again — a sentence repeated on every edit is chrome, not an answer.
   */
  protected readonly durationTouched = signal(false);

  /* ── The navigation stack ──────────────────────────────────────────── */

  private readonly page = signal<EditorPage | null>(null);
  protected readonly currentPage = computed(() => this.page());
  protected readonly depth = computed(() => (this.page() ? 1 : 0));

  /* ── Derived time ──────────────────────────────────────────────────── */

  /** The catalogue's span — sequential legs, which is every visit today. */
  protected readonly legSum = computed(() =>
    this.draft().legs.reduce((total, leg) => total + leg.minutes, 0),
  );

  protected readonly durationMinutes = computed(
    () =>
      this.draft().durationOverride ?? Math.max(this.legSum(), GRAIN_MINUTES),
  );

  /** THE DERIVED END. It is a computation and it is persisted nowhere. */
  protected readonly endMinute = computed(
    () => this.draft().startMinute + this.durationMinutes(),
  );

  protected readonly startLabel = computed(() =>
    clockLabel(this.draft().startMinute),
  );
  protected readonly endLabel = computed(() => clockLabel(this.endMinute()));
  /** `input[type=time]` speaks `HH:MM` and nothing else. */
  protected readonly startValue = this.startLabel;

  // Bounded by the SHIFT when there is one; by the civil day when there is
  // not, so an unreadable roster never narrows what can be typed.
  protected readonly startMinAttr = computed(() => {
    const shift = shiftOf(this.vm());
    return clockLabel(shift ? Math.max(0, shift.startMinute - 60) : 0);
  });
  protected readonly startMaxAttr = computed(() => {
    const shift = shiftOf(this.vm());
    return clockLabel(
      Math.min(DAY_MINUTES - 1, shift ? shift.endMinute + 60 : DAY_MINUTES - 1),
    );
  });

  /** The VISIT's ladder — built around the arrangement's summed span. */
  protected readonly durationLadder = computed(() =>
    ladderFor(this.legSum(), this.draft().startMinute),
  );

  /**
   * A LEG's ladder — built around that leg's own span, not the visit's.
   *
   * Same construction, different centre: on a service page the dominant
   * value is what this service takes, and offering the whole visit's rungs
   * there would make the commonest pick the wrong one.
   */
  protected readonly legLadder = computed(() => {
    const leg = this.currentLeg();
    return leg ? ladderFor(leg.minutes, this.draft().startMinute) : [];
  });

  /* ── The pinned summary strip ──────────────────────────────────────── */

  protected readonly clientHeadline = computed(
    () => this.draft().clients[0]?.label ?? this.vm().clientLabel,
  );

  /**
   * THE PARTICIPANTS, barber side — deduplicated by id, in leg order.
   *
   * Reads the DRAFT, so reassigning a leg's barber inside the service page
   * moves him into this list immediately, before anything is saved. The
   * fallback to the chair is not decoration: a visit whose legs have not
   * loaded still has a barber, and a participants group that renders empty
   * says the appointment has nobody working it.
   */
  protected readonly barbers = computed<readonly EditorBarberRow[]>(() => {
    const roster = this.uiBarbers();
    const portrait = (id: string) =>
      roster.find((barber) => barber.id === id)?.avatarSrc ?? null;
    const gathered: EditorBarberRow[] = [];
    for (const leg of this.draft().legs) {
      // The barber's SERVICES used to ride on a second line here. They are
      // the ladder's own next section; a participant repeating them said the
      // same thing twice and made the token two lines tall for nothing.
      if (gathered.some((barber) => barber.id === leg.barberId)) continue;
      gathered.push({
        id: leg.barberId,
        label: leg.barberName,
        tone: leg.barberTone,
        avatarSrc: portrait(leg.barberId),
      });
    }
    if (gathered.length === 0) {
      const vm = this.vm();
      return [
        {
          id: 'chair',
          label: vm.chairName,
          tone: vm.chairTone,
          avatarSrc: null,
        },
      ];
    }
    return gathered;
  });

  /* ── The barber picker ─────────────────────────────────────────────── */

  /**
   * Which barber row has its menu open, by id — the same `ui-menu` the view
   * toolbar's scope switcher uses (owner ruling 2026-08-27), not a combobox.
   *
   * ONE MENU PER ROW, which is what makes a split visit unambiguous: the menu
   * on Иван's row re-chairs Иван's legs and nobody else's. A single field for
   * the whole visit had to guess whose legs a pick meant, and the guess it
   * settled on ("the primary barber's") was a rule the surface never stated.
   */
  protected readonly barberMenu = signal<string | null>(null);

  /**
   * Press to open, press again to close — the same `togglePicker` contract
   * the view toolbar's scope switcher has. `ui-menu` light-dismisses only on
   * presses OUTSIDE its host, and the trigger is inside it, so a press on the
   * trigger reached the click handler with the menu still open and reopened
   * what it should have shut.
   */
  protected toggleBarberMenu(id: string): void {
    this.barberMenu.update((open) => (open === id ? null : id));
  }

  protected pickBarberFor(
    fromId: string,
    // The MENU's own shape (`name`), the one `setLegBarber` already takes —
    // not the input's (`label`). One vocabulary per boundary.
    option: { id: string; name: string; tone: number },
  ): void {
    this.barberMenu.set(null);
    if (option.id === fromId) return;
    this.draft.update((draft) => ({
      ...draft,
      legs: draft.legs.map((leg) =>
        leg.barberId === fromId
          ? {
              ...leg,
              barberId: option.id,
              barberName: option.name,
              barberTone: option.tone,
            }
          : leg,
      ),
    }));
  }

  /* ── The frame ─────────────────────────────────────────────────────── */

  /**
   * THE WHOLE CIVIL DAY — 00:00 to 24:00 (owner ruling 2026-08-26).
   *
   * It was a hundred minutes around the block, and a hundred minutes is not
   * a day: the grid DROPS what falls outside the window, so the shop's
   * afternoon was not merely off-screen, it was not in the frame at all —
   * unreachable by scrolling and undraggable into. The intermediate answer
   * (the roster plus an hour) had the same shape and the same flaw, one size
   * larger. A constant needs no fallbacks and can never disagree with the
   * data: whatever the roster says, midnight to midnight contains it.
   *
   * The day is SCROLLED, never compressed. `--staff-frame-minute` stays at
   * 2.4px, so the box shows about a hundred minutes at a time and a
   * 30-minute block is still 72px to grab. Fitting twenty-four hours into a
   * 240px box would put the five-minute grain at a sixth of a pixel, which
   * is the one thing the 5-minute ruling cannot survive. The grid centres
   * the frame on the edited block once, on open, and edge-scrolls under a
   * drag — those two are what make a day-long window navigable.
   *
   * ⚠ **A CONSTANT, which is what finally makes it safe.** Centring the
   * window on the draft made it chase the block: a drag emitted a new
   * interval, the window re-centred, every block moved in pixels under a
   * finger that had not moved, the pointer handler read a different minute
   * from the same position and published again — a feedback loop that pinned
   * a CPU. A window that depends on nothing cannot enter that loop at all.
   */
  protected readonly frameWindow = computed<GridWindow>(
    // Not the roster, not the roster plus a margin — MIDNIGHT TO MIDNIGHT
    // (owner ruling 2026-08-26). The shift is drawn inside it as shaded
    // closed hours, which is the honest way to show it: the shop's day is a
    // region OF the day, not the whole of what exists. Anything narrower is
    // a window the barber has to fight — the grid drops what falls outside
    // it, so every earlier attempt at "the useful part of the day" made some
    // other part unreachable. There is nothing to fall outside of now.
    () => ({ startMinute: 0, endMinute: DAY_MINUTES }),
  );

  /** One column — this chair, always. The neighbours ride in it at 7%. */
  protected readonly frameColumns = computed<readonly GridColumn[]>(() => {
    const vm = this.vm();
    const draft = this.draft();
    const edited: GridEvent = {
      id: vm.appointmentId,
      kind: 'visit',
      barberTone: vm.chairTone,
      startMinute: draft.startMinute,
      endMinute: this.endMinute(),
      title: draft.clients[0]?.label ?? vm.clientLabel,
      detail: draft.legs.map((leg) => leg.serviceLabel).join(' · ') || null,
      attribution: null,
      status: vm.status,
      terminal: false,
      past: false,
      accessibleName: this.frameSummary(),
      statusIcon: null,
    };

    const neighbours = vm.neighbours.map<GridEvent>((neighbour, index) => ({
      id: `neighbour-${index}`,
      kind: 'visit',
      barberTone: neighbour.tone,
      startMinute: neighbour.startMinute,
      endMinute: neighbour.endMinute,
      title: neighbour.name,
      detail: null,
      attribution: null,
      status: null,
      terminal: false,
      past: true,
      accessibleName: neighbour.name,
      statusIcon: null,
    }));

    return [
      {
        id: 'chair',
        title: vm.chairName,
        detail: null,
        dayNumber: null,
        isToday: vm.nowMinute !== null,
        avatarSrc: null,
        events: [...neighbours, edited],
        // ⚠ `shiftOf`, not the raw pair — the same reading `frameWindow` uses.
        // Handing the grid an inverted window makes `closedRuns` drop it and
        // paint the WHOLE frame as shut hours, so a chair rostered to
        // midnight had every minute of its day drawn closed.
        open: [shiftOf(vm) ?? { startMinute: 0, endMinute: DAY_MINUTES }],
      },
    ];
  });

  /**
   * The AUTHORITATIVE description of the frame, and the only narration of it.
   *
   * Everything drawn inside the frame is `aria-hidden`, so this sentence
   * carries both boundaries, both neighbours and the shift regardless of what
   * the window happens to be showing. Assert its CONTENT in a test: with the
   * visible twin deleted (comment 6), a regression here is invisible to
   * everyone who can see.
   */
  protected readonly frameSummary = computed(() => {
    const vm = this.vm();
    const range = `${this.startLabel()} – ${this.endLabel()}`;
    const shift = `${clockLabel(vm.rosterStartMinute)} – ${clockLabel(vm.rosterEndMinute)}`;
    const around = vm.neighbours
      .map(
        (neighbour) =>
          `${neighbour.name} ${clockLabel(neighbour.startMinute)} – ${clockLabel(neighbour.endMinute)}`,
      )
      .join(', ');
    return [
      `${range}, ${this.minutesLabel(this.durationMinutes())}`,
      vm.chairName,
      shift,
      around,
    ]
      .filter(Boolean)
      .join(' · ');
  });

  /**
   * The line under the frame is SILENT by default.
   *
   * It speaks only for something the picture cannot draw: a neighbour that
   * may be off-screen, or a consequence (no online booking) that a hatch
   * cannot state. Everything else the frame already draws.
   */
  protected readonly frameVerdict = computed<{
    kind: 'conflict' | 'outsideRoster';
    name: string;
    start: string;
    end: string;
    time: string;
  } | null>(() => {
    const vm = this.vm();
    const start = this.draft().startMinute;
    const end = this.endMinute();

    const clash = vm.neighbours.find(
      (neighbour) => neighbour.startMinute < end && start < neighbour.endMinute,
    );
    if (clash) {
      return {
        kind: 'conflict',
        name: clash.name,
        start: clockLabel(clash.startMinute),
        end: clockLabel(clash.endMinute),
        time: '',
      };
    }

    // A roster that cannot be read is not a roster the visit can be OUTSIDE
    // of. Judging against the raw pair pinned this warning on for every visit
    // in a chair rostered to midnight — a footnote that is always on is a
    // footnote nobody reads when it finally means something.
    const shift = shiftOf(vm);
    if (shift && (start < shift.startMinute || end > shift.endMinute)) {
      return {
        kind: 'outsideRoster',
        name: '',
        start: '',
        end: '',
        time: clockLabel(shift.startMinute),
      };
    }
    return null;
  });

  /* ── Pages: their subjects ─────────────────────────────────────────── */

  protected readonly currentLeg = computed(() => {
    const page = this.page();
    if (!page || page.kind !== 'service') return null;
    return (
      this.draft().legs.find((leg) => leg.seatId === page.subjectId) ?? null
    );
  });

  protected readonly currentClient = computed(() => {
    const page = this.page();
    if (!page || page.kind !== 'client') return null;
    return (
      this.draft().clients.find((client) => client.id === page.subjectId) ??
      null
    );
  });

  /** Every barber this visit already knows about, the chair included. */
  protected readonly barberOptions = computed(() => {
    // THE ROSTER when it is bound — real ids, real portraits. The derived
    // fallback below keys a synthesized chair by its NAME, which is not an
    // id and never matched anything; it survives only for the case where no
    // roster is supplied.
    const roster = this.uiBarbers();
    if (roster.length > 0) {
      return roster.map((barber) => ({
        id: barber.id,
        name: barber.label,
        tone: barber.tone,
        avatarSrc: barber.avatarSrc,
      }));
    }
    const vm = this.vm();
    const seen = new Map<
      string,
      { id: string; name: string; tone: number; avatarSrc: string | null }
    >();
    for (const leg of this.draft().legs) {
      seen.set(leg.barberId, {
        id: leg.barberId,
        name: leg.barberName,
        tone: leg.barberTone,
        avatarSrc: null,
      });
    }
    if (!seen.has('chair')) {
      seen.set(vm.chairName, {
        id: vm.chairName,
        name: vm.chairName,
        tone: vm.chairTone,
        avatarSrc: null,
      });
    }
    return [...seen.values()];
  });

  /** The consequence strip under a service page's large title — live. */
  protected readonly legConsequence = computed(() => {
    const leg = this.currentLeg();
    if (!leg) return '';
    const chair = this.vm().chairName;
    const who = leg.barberName === chair ? chair : leg.barberName;
    return `${this.startLabel()} – ${this.endLabel()} · ${who}`;
  });

  protected readonly serviceResults = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('bg');
    const chosen = new Set(this.draft().legs.map((leg) => leg.serviceLabel));
    return this.uiServices()
      .filter((service) =>
        service.label.toLocaleLowerCase('bg').includes(query),
      )
      .map((service) => ({ ...service, selected: chosen.has(service.label) }));
  });

  protected readonly clientResults = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('bg');
    const chosen = new Set(this.draft().clients.map((client) => client.id));
    return this.uiClients()
      .filter((client) => client.label.toLocaleLowerCase('bg').includes(query))
      .map((client) => ({ ...client, selected: chosen.has(client.id) }));
  });

  /* ── The line under a leg's row ────────────────────────────────────── */

  /**
   * `30 мин · 20,00 €`, and the barber ONLY when he is not the chair.
   *
   * When they agree the frame's owner header has already said it once, and
   * repeating it on every row is the duplication that deleted the `Стол` row.
   */
  protected legLine(leg: DraftLeg): string {
    const parts = [this.minutesLabel(leg.minutes)];
    if (leg.priceLabel) parts.push(leg.priceLabel);
    if (leg.barberName !== this.vm().chairName) parts.push(leg.barberName);
    return parts.join(' · ');
  }

  protected minutesLabel(minutes: number): string {
    return this.transloco.translate('staff.visit.minutes', { minutes });
  }

  protected statusTone(status: string): UiBadgeTone {
    return STATUS_TONES.get(status) ?? 'neutral';
  }

  protected clientLine(client: DraftClient): string {
    return [client.phone, client.meta].filter(Boolean).join(' · ');
  }

  /* ── Navigation ────────────────────────────────────────────────────── */

  protected push(
    kind: EditorPageKind,
    subjectId: string | null,
    originTestId: string | null,
  ): void {
    // Depth is exactly one: a push from a child would be a different screen,
    // and this sheet is not the place for one.
    if (this.page()) return;
    this.query.set('');
    this.page.set({ kind, subjectId, originTestId });
    this.host.nativeElement.scrollTop = 0;
    // Focus lands on the page CONTAINER, not on its first control, so a
    // price field cannot steal the keyboard on entry.
    this.focusLater('.staff-visit__page');
  }

  protected pop(): void {
    const origin = this.page()?.originTestId ?? null;
    this.page.set(null);
    if (origin) this.focusLater(`[data-testid="${origin}"]`);
  }

  /**
   * ⚠ THE SHEET OWNS THE DISMISS NOW (owner ruling 2026-08-26).
   *
   * `✕`, the backdrop, Escape and the drag-down all reach the shell, which
   * closes outright from any depth — this component no longer sees them, and
   * `dismissed` survives only for `discard()`. The rule they used to
   * discharge here, *back is not intended to dismiss a sheet*, is discharged
   * by the page's own `‹` instead: a pushed page carries the way back to the
   * ladder, so the dismiss is never the only exit from a child.
   */
  /**
   * The UNTRANSPILED translation, placeholders and all.
   *
   * `translate()` always runs the transpiler, and the grid does its own
   * filling — it takes `{{minutes}} мин` and substitutes per frame as the
   * block is dragged. Asking `translate()` for that string is a trap in both
   * directions: with no params the hole is filled with nothing and the copy
   * reads `Най-малко  мин`, and with `{ minutes: '{{minutes}}' }` — which is
   * what this used to do — the transpiler substitutes the placeholder with
   * ITSELF and rescans the result forever. That is a synchronous infinite
   * loop inside `afterNextRender`: the renderer never gets the frame back,
   * the tab wedges hard enough that the debugger has to interrupt it, and no
   * error is ever printed. Read the raw table instead.
   */
  private rawCopy(key: string): string {
    const table = this.transloco.getTranslation(this.transloco.getActiveLang());
    const raw = (table as Record<string, unknown> | undefined)?.[key];
    // A scope that has not loaded leaves `translate()` as the honest
    // fallback — it returns the key, which is what a missing string looks
    // like everywhere else in the app.
    return typeof raw === 'string' ? raw : this.transloco.translate(key);
  }

  private resolveDragCopy(): void {
    afterNextRender(
      () => {
        this.dragCopy.set({
          handleStart: this.rawCopy('staff.visit.handleStart'),
          handleEnd: this.rawCopy('staff.visit.handleEnd'),
          blockRole: this.rawCopy('staff.visit.blockRole'),
          minutes: this.rawCopy('staff.visit.minutes'),
          overlap: this.rawCopy('staff.visit.overlapShort'),
          outside: this.rawCopy('staff.visit.outsideShort'),
          tooShort: this.rawCopy('staff.visit.tooShort'),
        });
      },
      { injector: this.injector },
    );
  }

  private focusLater(selector: string): void {
    afterNextRender(
      () => {
        this.host.nativeElement
          .querySelector<HTMLElement>(selector)
          ?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /* ── Editing the draft ─────────────────────────────────────────────── */

  /**
   * The words the frame's drag surfaces need.
   *
   * The grid formats every number itself and takes every word from here, so
   * the time-grid library stays free of copy — the convention `zoneLabel` and
   * `allDayLabel` already set.
   */
  /**
   * ⚠ `translate()` is called inside `untracked`, and that is not a nicety.
   *
   * `TranslocoService.translate` reads signals it also WRITES — a lazy scope
   * load is a write — so calling it from a bare `computed` makes the computed
   * invalidate itself the moment it evaluates: it recomputes, writes, is
   * dirtied by its own write, and recomputes again. It never settles. The
   * symptom is a pinned CPU and a sheet that never paints, which is exactly
   * what shipped for one build of this component.
   *
   * The language IS real reactive state, so it stays tracked; the lookups
   * that depend on it do not.
   */
  /**
   * ⚠ NOT reactive, and that is the fix rather than an oversight.
   *
   * `TranslocoService.translate` reads state it also WRITES — a lazy scope
   * load is a write — so calling it from a tracked `computed` makes the
   * computed dirty itself the instant it evaluates: it recomputes, writes, is
   * invalidated by its own write, recomputes. It never settles, and the
   * symptom is a pinned CPU and a sheet that never paints. Tracking
   * `langChanges$` instead does not help; the write happens either way.
   *
   * So the lookups run once, lazily, on the first template read — which the
   * `*transloco` directive guarantees is after the scope has loaded — and are
   * cached from then on. **Stated limit:** switching language while this
   * sheet is open leaves the drag readout in the old one until it is
   * reopened. Every other string on the surface goes through the directive
   * and updates normally; these seven do not, because they are handed to a
   * child as data rather than rendered here.
   */
  /**
   * ⚠ Resolved AFTER the first render, never during construction or change
   * detection — and the distinction is the whole bug.
   *
   * `TranslocoService.translate()` reads state it also writes: a scope that
   * has not loaded yet is fetched as a side effect of asking for a key. Call
   * it from a `computed()` and the computed dirties itself forever. Call it
   * from a FIELD INITIALIZER instead — the obvious fix, and the one shipped
   * first — and it re-enters during component construction and pins the main
   * thread so hard that Chrome's own debugger protocol stops answering. It
   * reproduces in a browser and never in jsdom, so the component's spec stays
   * green while the app is frozen.
   *
   * `afterNextRender` is the one moment that is neither: the scope has loaded
   * (the `*transloco` directive guaranteed it), the first render is finished,
   * and setting a signal there costs exactly one more pass. For that single
   * frame the grid sees empty strings, which its own contract defines as
   * "say it with the numbers alone" — a degraded readout for one frame, not a
   * wrong one.
   */
  protected readonly dragCopy = signal<GridDragCopy>({
    handleStart: '',
    handleEnd: '',
    blockRole: '',
    minutes: '',
    overlap: '',
    outside: '',
    tooShort: '',
  });

  /**
   * A gesture in flight — the draft follows the finger and nothing is written.
   *
   * The grid holds its own draft only until we answer; answering here on every
   * snap is what keeps the two pictures identical while the finger is down.
   */
  protected onFrameDraft(draft: GridDraft): void {
    const span = Math.max(GRAIN_MINUTES, draft.endMinute - draft.startMinute);
    this.draft.update((current) => {
      // ⚠ There is no `endMinute` FIELD to write. The end is derived from
      // `durationOverride ?? legSum`, so a resize pins the duration and a
      // move leaves it alone — writing a phantom field made every resize
      // snap back to the services' sum and re-emit from the grid.
      const overrideNow =
        span === Math.max(this.legSum(), GRAIN_MINUTES) ? null : span;

      // No-op when nothing actually moved. A redundant write is a redundant
      // render, and a redundant render mid-gesture is how a loop starts.
      if (
        current.startMinute === draft.startMinute &&
        current.durationOverride === overrideNow
      ) {
        return current;
      }
      return {
        ...current,
        startMinute: draft.startMinute,
        durationOverride: overrideNow,
      };
    });
  }

  /**
   * The gesture ended. THIS is the write.
   *
   * `kind` cannot be re-derived from the numbers — a move that happens to land
   * on a legal duration is arithmetically identical to two resizes, and the
   * server command differs by which one the barber actually performed.
   */
  protected onFrameCommit(commit: GridCommit): void {
    this.onFrameDraft(commit);
    this.committed.emit(
      commit.kind === 'move'
        ? { kind: 'move', startMinute: commit.startMinute }
        : {
            kind: 'resize',
            // A move fixes the start; a resize reports whichever edge left
            // the appointment's own interval.
            edge:
              commit.startMinute !== this.vm().startMinute ? 'start' : 'end',
            startMinute: commit.startMinute,
            endMinute: commit.endMinute,
          },
    );
  }

  protected pickDay(dayKey: string): void {
    // Moving the day HOLDS the duration and slides the whole block — the
    // same invariant `Начало` holds.
    this.draft.update((draft) => ({
      ...draft,
      dayKey,
      dayLabel: this.dayLabelFor(dayKey),
    }));
    // Collapsing the calendar DESTROYS the button that was just pressed, and
    // a modal sheet that drops focus to `<body>` restarts every reader at the
    // top of the ladder with nothing announced. Focus goes back to the pill,
    // which now carries the new date as its own label — so the change is
    // spoken by the thing the user lands on. The same collapse fires from the
    // three step buttons, which is why this lives in `pickDay` rather than in
    // the calendar's own handler.
    const wasOpen = this.dayOpen();
    this.dayOpen.set(false);
    if (wasOpen) this.focusLater('[data-testid="staff-visit-day-pill"]');
  }

  /** `вт, 26 авг` — the pill is ALWAYS value-bearing, never a bare `›`. */
  private dayLabelFor(dayKey: string): string {
    const [year, month, day] = dayKey.split('-').map(Number);
    return new Intl.DateTimeFormat(this.transloco.getActiveLang(), {
      weekday: 'short',
      day: 'numeric',
      // ⚠ `long`, and it is not a style preference. Bulgarian renders a
      // `short` month NUMERICALLY — `month: 'short'` gives `ср, 26.08`, not
      // `ср, 26 авг` — so the pill was showing a number where it promised a
      // name. `long` is the shortest form that is actually a word in both
      // languages. `weekday: 'short'` is already the three-letter form.
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
  }

  protected commitStart(value: string): void {
    const minute = parseClock(value);
    if (minute === null) return;
    // The duration is the stored fact, so it is ALWAYS pinned: a client
    // arriving ten minutes late does not get a ten-minute-shorter cut.
    this.draft.update((draft) => ({ ...draft, startMinute: snap(minute) }));
  }

  protected setDuration(minutes: number): void {
    this.draft.update((draft) => ({
      ...draft,
      durationOverride: minutes === this.legSum() ? null : minutes,
    }));
    this.durationTouched.set(true);
    this.durationMenu.set(false);
  }

  /**
   * A leg's own duration.
   *
   * While the visit's span is tracking the catalogue this moves the END and
   * leaves the price exactly where it was — which is the whole of
   * `Промяната на времето не променя цената.`
   */
  protected setLegDuration(seatId: string, minutes: number): void {
    this.draft.update((draft) => ({
      ...draft,
      legs: draft.legs.map((leg) =>
        leg.seatId === seatId ? { ...leg, minutes } : leg,
      ),
    }));
    this.durationTouched.set(true);
    this.legDurationMenu.set(false);
  }

  protected setLegBarber(
    seatId: string,
    barber: { id: string; name: string; tone: number },
  ): void {
    this.draft.update((draft) => ({
      ...draft,
      legs: draft.legs.map((leg) =>
        leg.seatId === seatId
          ? {
              ...leg,
              barberId: barber.id,
              barberName: barber.name,
              barberTone: barber.tone,
            }
          : leg,
      ),
    }));
    this.legBarberMenu.set(false);
  }

  protected setLegPrice(seatId: string, value: string): void {
    const trimmed = value.trim();
    this.draft.update((draft) => ({
      ...draft,
      legs: draft.legs.map((leg) =>
        leg.seatId === seatId ? { ...leg, priceLabel: trimmed || null } : leg,
      ),
    }));
  }

  protected removeLeg(seatId: string): void {
    this.draft.update((draft) => ({
      ...draft,
      legs: draft.legs.filter((leg) => leg.seatId !== seatId),
    }));
    this.pop();
  }

  protected toggleService(option: VisitEditorServiceOption): void {
    // The page STAYS on select: cut + beard + wash must not reopen a list
    // three times.
    this.draft.update((draft) => {
      const existing = draft.legs.find(
        (leg) => leg.serviceLabel === option.label,
      );
      if (existing) {
        return {
          ...draft,
          legs: draft.legs.filter((leg) => leg !== existing),
        };
      }
      const vm = untracked(() => this.vm());
      return {
        ...draft,
        legs: [
          ...draft.legs,
          {
            seatId: `draft-${option.id}`,
            serviceLabel: option.label,
            minutes: option.minutes,
            priceLabel: option.priceLabel,
            barberId: vm.chairName,
            barberName: vm.chairName,
            barberTone: vm.chairTone,
          },
        ],
      };
    });
  }

  protected toggleClient(option: VisitEditorClientOption): void {
    this.draft.update((draft) => {
      const existing = draft.clients.find((client) => client.id === option.id);
      if (existing) {
        return {
          ...draft,
          clients: draft.clients.filter((client) => client !== existing),
        };
      }
      return { ...draft, clients: [...draft.clients, { ...option }] };
    });
  }

  /** The last row of the client search: the guest who has no record yet. */
  protected createGuest(): void {
    const label = this.query().trim();
    if (!label) return;
    this.draft.update((draft) => ({
      ...draft,
      clients: [
        ...draft.clients,
        {
          id: `guest-${draft.clients.length}`,
          label,
          phone: null,
          phoneHref: null,
          meta: null,
        },
      ],
    }));
    this.query.set('');
  }

  protected pickPromo(label: string | null): void {
    this.draft.update((draft) => ({ ...draft, promoLabel: label }));
    this.pop();
  }

  /**
   * The button BECOMES the field.
   *
   * Focus moves in the same beat, because a reveal that costs a second tap
   * has not done what was asked. And the textarea does not collapse back
   * when it is emptied mid-session — a control that vanishes from under the
   * caret is worse than a two-line empty box.
   */
  protected openNote(): void {
    this.noteOpen.set(true);
    this.focusLater('[data-testid="staff-visit-note-field"]');
  }

  protected commitNote(value: string): void {
    const trimmed = value.trim();
    this.draft.update((draft) => ({ ...draft, note: trimmed || null }));
  }

  protected discard(): void {
    this.draft.set(seedDraft(this.vm()));
    this.durationTouched.set(false);
    this.noteOpen.set(false);
  }

  /* ── Small template helpers ────────────────────────────────────────── */

  protected toggleDay(): void {
    this.dayOpen.update((open) => !open);
  }

  /**
   * Step the draft a day either way — Outlook's calendar bar, and the reason
   * the month grid is a jump rather than the only route.
   *
   * `relativeDay` walks from the APPOINTMENT's day, not the draft's, so this
   * steps from wherever the draft already is instead of snapping back.
   */
  protected stepDay(offset: number): void {
    const [year, month, day] = this.draft().dayKey.split('-').map(Number);
    const at = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
    at.setUTCDate(at.getUTCDate() + offset);
    this.pickDay(at.toISOString().slice(0, 10));
  }

  /** The one date every shop names out loud. */
  protected goToday(): void {
    this.pickDay(new Date().toISOString().slice(0, 10));
  }

  protected onQuery(value: string): void {
    this.query.set(value);
  }

  /** `Днес` / `Утре` — most date changes are ±1 day and should not need aim. */
  protected relativeDay(offset: number): string {
    const [year, month, day] = this.vm().dayKey.split('-').map(Number);
    const at = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
    at.setUTCDate(at.getUTCDate() + offset);
    return at.toISOString().slice(0, 10);
  }

  /**
   * Monday-first weekday key — Bulgaria's week, stated not derived.
   *
   * The grid is headless by design: the labels are localized and
   * Monday-first is a product decision, not a layout one, so the consumer
   * projects them.
   */
  protected readonly weekdayNames = computed(() => {
    const locale = this.transloco.getActiveLang();
    // 2026-08-03 is a Monday; walking seven from it labels the key in order.
    return Array.from({ length: 7 }, (_, index) =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(2026, 7, 3 + index))),
    );
  });

  /** The draft month as weeks of day cells, `null` padding either end. */
  protected readonly calendarWeeks = computed(() => {
    const month = this.draft().dayKey.slice(0, 7);
    const [year, monthNumber] = month.split('-').map(Number);
    const first = new Date(Date.UTC(year ?? 1970, (monthNumber ?? 1) - 1, 1));
    const days = new Date(
      Date.UTC(year ?? 1970, monthNumber ?? 1, 0),
    ).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;

    const cells: ({ day: number; dayKey: string } | null)[] = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: days }, (_, index) => ({
        day: index + 1,
        dayKey: `${month}-${String(index + 1).padStart(2, '0')}`,
      })),
    ];
    while (cells.length % 7 !== 0) cells.push(null);

    const weeks: (typeof cells)[] = [];
    for (let index = 0; index < cells.length; index += 7) {
      weeks.push(cells.slice(index, index + 7));
    }
    return weeks;
  });

  protected readonly snapMinutes = GRAIN_MINUTES;
}
