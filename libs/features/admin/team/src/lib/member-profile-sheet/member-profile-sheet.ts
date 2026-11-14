import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import type { AuthoredText, LocalizedText } from '@core/components';
import type { Barber } from '@core/entities';
import { type BarberProfileInput, TeamSystem } from '@core/systems';
import { UiButton, UiModalSheet, UiTextField } from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiNotice,
  UiSectionHeader,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import { TeamMemberStore } from '../team-member.store';
import { TeamWording } from '../team-wording.service';

/** The English a field shows: blank when it only repeats the Bulgarian (team onboarding D5, O5). */
function translationOf(text: LocalizedText | null): string {
  return text === null || text.en === text.bg ? '' : text.en;
}

/** A field's two drafts as the editor authors them. */
function authored(bg: string, en: string): AuthoredText {
  return { bg, en: en.trim().length === 0 ? null : en };
}

/**
 * «ИМЕ И ОПИСАНИЕ» — a barber record's public profile, whole (team
 * onboarding D5): the name, the title, a few words, Instagram and the
 * years of experience, in Bulgarian, with the English under «Превод (по
 * желание)» — a blank English is saved as the Bulgarian text.
 *
 * The sheet holds a draft and decides nothing: whether the draft may be
 * saved is `TeamSystem.editProfile`'s answer over the record, the same
 * rule the server asks, so «Запази» is offered exactly when the call would
 * be taken. Mounted while it is open, so every opening starts from the
 * record as it stands.
 */
@Component({
  selector: 'lib-member-profile-sheet',
  imports: [
    TranslocoDirective,
    UiButton,
    UiForegroundStyleDirective,
    UiModalSheet,
    UiNotice,
    UiSectionHeader,
    UiSheetActionBar,
    UiTextDirective,
    UiTextField,
  ],
  templateUrl: './member-profile-sheet.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `team-page`-prefixed.
  encapsulation: ViewEncapsulation.None,
})
export class MemberProfileSheet implements OnInit {
  protected readonly store = inject(TeamMemberStore);
  private readonly wording = inject(TeamWording);

  /** The record the sheet edits. */
  readonly uiBarber = input.required<Barber>();
  /** The sheet is leaving: its close animation runs. */
  readonly uiClosing = input(false);
  /** ✕, Escape, the scrim — or a save that landed. */
  readonly dismissed = output<void>();
  /** The close animation ended. */
  readonly closeFinished = output<void>();

  protected readonly name = signal('');
  protected readonly nameEn = signal('');
  protected readonly position = signal('');
  protected readonly positionEn = signal('');
  protected readonly bio = signal('');
  protected readonly bioEn = signal('');
  protected readonly instagram = signal('');
  protected readonly years = signal('');
  /** The drafts as the sheet opened on them — what «changed» is measured against. */
  private readonly opened = signal('');

  /** The profile the drafts spell — what «Запази» sends. */
  private readonly profile = computed<BarberProfileInput>(() => {
    const years = this.years().trim();
    return {
      name: authored(this.name(), this.nameEn()),
      title: authored(this.position(), this.positionEn()),
      bio: authored(this.bio(), this.bioEn()),
      instagramHandle: this.instagram(),
      yearsExperience: years.length === 0 ? null : Number(years),
    };
  });

  /** The record would take the draft (`TeamSystem.editProfile`) and the draft differs from what was opened. */
  protected readonly canSave = computed(
    () =>
      TeamSystem.editProfile(this.uiBarber(), this.profile(), null).ok &&
      JSON.stringify(this.profile()) !== this.opened(),
  );

  /** Why the save was refused, in the catalogue's words. */
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  /** The record as it stands when the sheet opens: read once. */
  ngOnInit(): void {
    const barber = untracked(this.uiBarber);
    this.name.set(barber.name.bg);
    this.nameEn.set(translationOf(barber.name));
    this.position.set(barber.title?.bg ?? '');
    this.positionEn.set(translationOf(barber.title));
    this.bio.set(barber.bio?.bg ?? '');
    this.bioEn.set(translationOf(barber.bio));
    this.instagram.set(barber.instagramHandle ?? '');
    this.years.set(
      barber.yearsExperience === null ? '' : String(barber.yearsExperience),
    );
    this.opened.set(JSON.stringify(untracked(this.profile)));
  }

  /** A field's typed text. */
  protected typed(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected async save(): Promise<void> {
    if (!this.canSave() || this.store.pending()) return;
    if (await this.store.saveProfile(this.profile())) this.dismissed.emit();
  }
}
