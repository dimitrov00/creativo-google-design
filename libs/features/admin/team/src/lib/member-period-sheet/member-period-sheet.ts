import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import type { Barber } from '@core/entities';
import { LocalDate } from '@core/primitives';
import { EmploymentSystem, TeamSystem } from '@core/systems';
import { UiButton, UiDateRow, UiModalSheet } from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiAlert,
  UiListGroup,
  UiNotice,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import { BookingsAheadStore } from '../bookings-ahead.store';
import { LeftoverVisits } from '../leftover-visits/leftover-visits';
import { LinkAnswer } from '../link.vm';
import {
  type PeriodOutlookVm,
  QUIET_OUTLOOK,
  periodOutlookVm,
} from '../period.presenter';
import { TeamMemberStore } from '../team-member.store';
import { TeamWording } from '../team-wording.service';

/**
 * «РАБОТЕН ПЕРИОД» — the day a barber starts and, when there is one, the
 * last day they work (team onboarding D2): outside the period nobody can
 * book them. Two days, each a date row (`ui-date-row`): the day in a
 * capsule that pops the month — the same rows every date in a form is
 * picked with. The last day is optional: «Без последен ден» is an answer
 * its month offers, never a row of its own (owner, 2026-11-16, against
 * LinkedIn's, Things' and Todoist's own optional dates).
 *
 * A last day is the way someone leaves the team (team onboarding D10):
 * once it is behind the shop's today the record leaves, the linked account
 * loses its staff access and its sessions end. The sheet says so under the
 * two days before anything is saved, and a save that would make the barber
 * leave AT ONCE — a last day already passed — is held behind a question.
 * One notice says it: the departure while nothing is left behind, the
 * visits left as a warning once there are some.
 *
 * Leaving cancels nothing: the bookings the barber holds after the last
 * day stay until someone moves or cancels them. The sheet reads the
 * barber's visits ahead once (`BookingsAheadStore`): the last day's month
 * dots the days they fall on, so the day is chosen against what it cuts,
 * and once a last day is drafted the visits after it are counted in a
 * warning and listed under it (`lib-leftover-visits`), each the way to its
 * day on the schedule, before the save.
 *
 * The sheet holds a draft and decides nothing: whether the two days make a
 * period is `TeamSystem.setPeriod`'s answer, the rule the server asks,
 * where the period stands today is `EmploymentSystem.outlookOf`'s, and
 * which bookings are left is `EmploymentSystem.leftoverVisitsOf`'s.
 * Mounted while it is open, so every opening starts from the record.
 */
@Component({
  selector: 'lib-member-period-sheet',
  imports: [
    LeftoverVisits,
    TranslocoDirective,
    UiAlert,
    UiButton,
    UiDateRow,
    UiForegroundStyleDirective,
    UiListGroup,
    UiModalSheet,
    UiNotice,
    UiSheetActionBar,
    UiTextDirective,
  ],
  providers: [BookingsAheadStore],
  templateUrl: './member-period-sheet.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `team-page`-prefixed.
  encapsulation: ViewEncapsulation.None,
})
export class MemberPeriodSheet implements OnInit {
  protected readonly store = inject(TeamMemberStore);
  private readonly wording = inject(TeamWording);
  private readonly ahead = inject(BookingsAheadStore);

  /** The record the sheet edits. */
  readonly uiBarber = input.required<Barber>();
  /** The shop's today, for the month and for a date's year. */
  readonly uiToday = input<LocalDate | null>(null);
  /** The sheet is leaving: its close animation runs. */
  readonly uiClosing = input(false);
  /** ✕, Escape, the scrim — or a save that landed. */
  readonly dismissed = output<void>();
  /** The close animation ended. */
  readonly closeFinished = output<void>();

  protected readonly locale = this.wording.locale;
  /** The start day as drafted; `null` only before the sheet has read the record. */
  protected readonly starts = signal<LocalDate | null>(null);
  protected readonly last = signal<LocalDate | null>(null);

  /**
   * The month the last day's row opens on while it holds no day: today's —
   * someone leaves about now, not in the month they started — or the
   * start's, for a period that begins later.
   */
  protected readonly lastOpensOn = computed(() => {
    const today = this.uiToday();
    const starts = this.starts();
    if (today === null || starts === null) return today ?? starts;
    return starts > today ? starts : today;
  });

  /** The two days make a period (`TeamSystem.setPeriod`). */
  protected readonly valid = computed(() => {
    const starts = this.starts();
    return (
      starts !== null &&
      TeamSystem.setPeriod(this.uiBarber(), starts, this.last(), null).ok
    );
  });

  /** The draft differs from the record. */
  private readonly changed = computed(() => {
    const barber = this.uiBarber();
    return (
      this.starts() !== barber.barberStartsLocalDate ||
      this.last() !== barber.barberLastWorkingLocalDate
    );
  });

  protected readonly canSave = computed(() => this.valid() && this.changed());

  /**
   * The day the barber's visits are read AFTER: yesterday — everything
   * from today on, whichever last day is drafted next — or the last day
   * drafted when that is further back. `null` until the shop's today is
   * known and no day is drafted.
   */
  private readonly watchedAfter = computed(() => {
    const today = this.uiToday();
    const last = this.last();
    if (today === null) return last;
    const yesterday = LocalDate.addDays(today, -1);
    return last !== null && last < yesterday ? last : yesterday;
  });

  /** The days the barber is booked on, from the day watched: the month's dots. */
  protected readonly bookedDays = computed(() => {
    const visits = this.ahead.visits();
    const after = this.watchedAfter();
    return visits === null || after === null
      ? []
      : EmploymentSystem.leftoverOf(visits, this.uiBarber().id, after)
          .leftoverLocalDates;
  });

  /** The visits after the last day drafted, oldest first; none with no day, or before they are read. */
  private readonly left = computed(() => {
    const visits = this.ahead.visits();
    const last = this.last();
    return visits === null || last === null
      ? null
      : EmploymentSystem.leftoverVisitsOf(visits, this.uiBarber().id, last);
  });

  /** What the last day drafted will do, and the question a save may be held behind. */
  protected readonly outlook = computed<PeriodOutlookVm>(() => {
    const memberWords = this.wording.memberWords();
    return memberWords === null
      ? QUIET_OUTLOOK
      : periodOutlookVm({
          barber: this.uiBarber(),
          lastLocalDate: this.last(),
          today: this.uiToday(),
          leftover: this.leftover(),
          leftoverFailed: this.ahead.failed(),
          memberWords,
          locale: this.locale(),
        });
  });
  /** How many visits the last day drafted leaves, and their days; `null` while unknown. */
  private readonly leftover = computed(() => {
    const left = this.left();
    const last = this.last();
    return left === null || last === null
      ? null
      : EmploymentSystem.leftoverOf(left, this.uiBarber().id, last);
  });

  /**
   * The visits listed under the warning: the ones it counts — none while
   * the period says nothing about them (a record with no period to end).
   */
  protected readonly leftoverVisits = computed(() =>
    this.outlook().notice?.listsVisits === true ? (this.left() ?? []) : [],
  );

  /** The question before a save that makes the barber leave at once is up. */
  protected readonly questionOpen = signal(false);

  /** Why the save was refused, in the catalogue's words. */
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  constructor() {
    // The barber's visits ahead are read once; a last day drafted further
    // back than what is held reads again from there.
    effect(() => {
      const barberId = this.uiBarber().id;
      const after = this.watchedAfter();
      untracked(() => this.ahead.watch(barberId, after));
    });
  }

  /** The record as it stands when the sheet opens: read once. */
  ngOnInit(): void {
    const barber = untracked(this.uiBarber);
    this.starts.set(barber.barberStartsLocalDate);
    this.last.set(barber.barberLastWorkingLocalDate);
  }

  /** «Запази»: a last day already passed is asked about first; any other period is sent. */
  protected save(): void {
    if (!this.canSave() || this.store.pending()) return;
    if (this.outlook().question !== null) {
      this.questionOpen.set(true);
      return;
    }
    void this.send();
  }

  /** The question answered: «Напуска» sends the period, anything else lets it go. */
  protected answer(linkAnswer: string): void {
    this.questionOpen.set(false);
    if (linkAnswer === LinkAnswer.Confirm) void this.send();
  }

  private async send(): Promise<void> {
    const starts = this.starts();
    if (starts === null || !this.canSave() || this.store.pending()) return;
    if (await this.store.savePeriod(starts, this.last())) {
      this.dismissed.emit();
    }
  }
}
