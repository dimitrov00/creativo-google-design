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
import type { LocalDate } from '@core/primitives';
import { TeamSystem } from '@core/systems';
import { UiButton, UiModalSheet } from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiAlert,
  UiListGroup,
  UiListRow,
  UiNotice,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import { BookingsAheadStore } from '../bookings-ahead.store';
import { LinkAnswer } from '../link.vm';
import { type PeriodOutlookVm, periodOutlookVm } from '../period.presenter';
import { TeamDayMenu } from '../team-day-menu/team-day-menu';
import { TeamMemberStore } from '../team-member.store';
import { TeamWording } from '../team-wording.service';
import { dayWords } from '../team.format';

/**
 * «ПЕРИОД НА РАБОТА» — the day a barber starts and, when there is one, the
 * last day they work (team onboarding D2): outside the period nobody can
 * book them. Two days, each picked in the DS's month.
 *
 * A last day is the way someone leaves the team (team onboarding D10):
 * once it is behind the shop's today the record leaves, the linked account
 * loses its staff access and its sessions end. The sheet says so under the
 * two days before anything is saved, and a save that would make the barber
 * leave AT ONCE — a last day already passed — is held behind a question.
 *
 * Leaving cancels nothing: the bookings the barber holds after the last
 * day stay until someone moves or cancels them. The sheet asks how many
 * there are each time a last day is picked (`BookingsAheadStore`) and says
 * so under the days, before the save.
 *
 * The sheet holds a draft and decides nothing: whether the two days make a
 * period is `TeamSystem.setPeriod`'s answer, the rule the server asks,
 * where the period stands today is `EmploymentSystem.outlookOf`'s, and
 * which bookings are left is `EmploymentSystem.leftoverOf`'s.
 * Mounted while it is open, so every opening starts from the record.
 */
@Component({
  selector: 'lib-member-period-sheet',
  imports: [
    TeamDayMenu,
    TranslocoDirective,
    UiAlert,
    UiButton,
    UiForegroundStyleDirective,
    UiListGroup,
    UiListRow,
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

  protected readonly startsWords = computed(() => {
    const day = this.starts();
    return day === null ? '' : dayWords(day, this.uiToday(), this.locale());
  });

  /** The last day in words; `null` when there is none. */
  protected readonly lastWords = computed(() => {
    const day = this.last();
    return day === null ? null : dayWords(day, this.uiToday(), this.locale());
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

  /** What the last day drafted will do, and the question a save may be held behind. */
  protected readonly outlook = computed<PeriodOutlookVm>(() => {
    const memberWords = this.wording.memberWords();
    return memberWords === null
      ? { note: null, question: null, leftover: null }
      : periodOutlookVm({
          barber: this.uiBarber(),
          lastLocalDate: this.last(),
          today: this.uiToday(),
          leftover: this.ahead.leftover(),
          leftoverFailed: this.ahead.failed(),
          memberWords,
          locale: this.locale(),
        });
  });
  /** The question before a save that makes the barber leave at once is up. */
  protected readonly questionOpen = signal(false);

  /** Why the save was refused, in the catalogue's words. */
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  constructor() {
    // Each last day picked is asked about once: what it would leave behind.
    effect(() => {
      const barberId = this.uiBarber().id;
      const last = this.last();
      untracked(() => this.ahead.ask(barberId, last));
    });
  }

  /** The record as it stands when the sheet opens: read once. */
  ngOnInit(): void {
    const barber = untracked(this.uiBarber);
    this.starts.set(barber.barberStartsLocalDate);
    this.last.set(barber.barberLastWorkingLocalDate);
  }

  /**
   * «Без последен ден»: the day goes, and so does this row — the keyboard
   * moves to the last day's value, so the sheet still hears it.
   */
  protected clearLast(row: TeamDayMenu): void {
    this.last.set(null);
    row.focus();
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
