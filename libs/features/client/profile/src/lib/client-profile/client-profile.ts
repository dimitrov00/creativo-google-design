import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  AccountStateService,
  ageDayOf,
  nameRefusalCodes,
} from '@creativo/features/client/account-state';
import { BirthDate } from '@core/components';
import { Profile, type User } from '@core/entities';
import { LocalDate } from '@core/primitives';
import { AgeSystem, PhoneSystem, ProfileCompletionSystem } from '@core/systems';
import { LoadState, loadStateWords } from '@creativo/shared/view-state';
import { formatWallClock } from '@creativo/ui/wall-clock';
import {
  SessionIdentityService,
  SiteHeaderComponent,
} from '@creativo/features/shared/shell';
import { CLOCK_PORTS } from '@creativo/infrastructure/firebase-app';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import {
  UiAvatar,
  UiButton,
  UiDateField,
  type UiDateFieldBlurEvent,
  UiDateFieldFill,
  type UiDateFieldParts,
  UiIcon,
  UiModalSheet,
  UiSkeleton,
  UiTextField,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiPaddingDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiMenu,
  UiMenuItem,
  UiMenuTrigger,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import { ProfileStore } from '../profile.store';

/** Which value the sheet edits — the field `profileEditField`, the ONLY
 *  source of these strings (Law 6). */
const ProfileEditField = {
  /** The first and last name, edited together. */
  Name: 'NAME',
  /** The date of birth. */
  Birthday: 'BIRTHDAY',
} as const;
type ProfileEditField =
  (typeof ProfileEditField)[keyof typeof ProfileEditField];

/** Which value the sheet is currently editing. One editor at a time is not
 *  a policy but a fact — the sheet is modal, so no second row can be
 *  tapped while it is up; a union makes any other state unrepresentable. */
type ProfileEdit =
  | { readonly profileEditField: typeof ProfileEditField.Name }
  | { readonly profileEditField: typeof ProfileEditField.Birthday };

/**
 * `/account/profile` — the personal-information surface (Apple's split:
 * *who you are* here, *how the app behaves* in the menu's locale/theme
 * chips). Read-only by default; tapping a row opens ONE modal sheet whose
 * body switches on what is being edited, with the close chip as cancel and
 * a docked action bar carrying Save — HIG's "self-contained subtask".
 *
 * Phone and email render as inert rows: changing either is not offered —
 * contact change is not shipped (D12(b)), so there is no flow behind them.
 * They carry no chevron and no interactive grammar, so the screen never
 * promises an affordance it can't honor.
 */
@Component({
  selector: 'lib-client-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SiteHeaderComponent,
    TranslocoDirective,
    UiAvatar,
    UiButton,
    UiDateField,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiMenu,
    UiMenuItem,
    UiMenuTrigger,
    UiModalSheet,
    UiPaddingDirective,
    UiSheetActionBar,
    UiSkeleton,
    UiStack,
    UiTextDirective,
    UiTextField,
    UiVisuallyHiddenDirective,
  ],
  providers: [ProfileStore],
  templateUrl: './client-profile.html',
  styleUrl: './client-profile.css',
  host: {
    'data-testid': 'profile-page',
    '[attr.data-state]': 'pageStateWord()',
  },
})
export class ClientProfile {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transloco = inject(TranslocoService);

  protected readonly store = inject(ProfileStore);
  protected readonly accountState = inject(AccountStateService);
  protected readonly identity = inject(SessionIdentityService);
  protected readonly account = this.accountState.account;

  /** The load states and the editor's fields, for the template. */
  protected readonly LoadState = LoadState;
  protected readonly ProfileEditField = ProfileEditField;

  protected readonly pageState = computed<LoadState>(() => {
    if (this.accountState.accountLoading()) return LoadState.Loading;
    return this.account() ? LoadState.Ready : LoadState.Empty;
  });

  /** The host's `data-state` — `loading` · `ready` · `empty`. */
  protected readonly pageStateWord = computed(
    () => loadStateWords[this.pageState()],
  );

  /**
   * The day the birth-date window is judged on — the UTC civil date, taken
   * once from the clock port (the server's `updateProfile` check judges the
   * same day).
   */
  private readonly ageDay = ageDayOf(inject(CLOCK_PORTS));

  /* ── Portrait ─────────────────────────────────────────────────────── */

  /** Local object URL of a just-picked photo — wins over the storage
   *  lookup so the face changes the instant the upload succeeds, without
   *  waiting for `find()` to re-resolve. */
  private readonly photoPreviewUrl = signal<string | null>(null);
  protected readonly photoErrorCode = signal<string | null>(null);
  protected readonly photoMenuOpen = signal(false);

  /** Set the moment a photo is removed, so the portrait falls back to the
   *  monogram without waiting for the storage lookup to re-resolve. */
  private readonly photoRemoved = signal(false);

  protected readonly portraitUrl = computed(() => {
    if (this.photoRemoved()) return null;
    return this.photoPreviewUrl() ?? this.identity.avatarUrl();
  });
  protected readonly fullName = computed(() => {
    const user = this.account();
    return user === null ? this.identity.displayName() : Profile.fullName(user);
  });

  /* ── Rows ─────────────────────────────────────────────────────────── */

  protected readonly birthDateLabel = computed(() => {
    const birthDate = this.account()?.birthDate;
    if (!birthDate) return null;
    // A civil date, printed as stored on the cached wall-clock formatter
    // (no zone consulted, so no device ever shows the previous day). The
    // language is read as before — once per run, not as a dependency.
    const day = LocalDate.parse(birthDate);
    return day.ok
      ? formatWallClock(day.value, null, this.transloco.getActiveLang(), {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : null;
  });

  protected readonly phoneLabel = computed(() => {
    const phone = this.account()?.phone ?? null;
    return phone === null ? null : PhoneSystem.formatInternational(phone);
  });
  protected readonly emailLabel = computed(() => this.account()?.email ?? null);

  /* ── Sheet ────────────────────────────────────────────────────────── */

  private readonly _editing = signal<ProfileEdit | null>(null);
  private readonly _sheetClosing = signal(false);
  protected readonly editing = this._editing.asReadonly();
  protected readonly sheetClosing = this._sheetClosing.asReadonly();
  /** `open` outranks `closing`, matching every other sheet in the app. */
  protected readonly sheetOpen = computed(
    () => this._editing() !== null && !this._sheetClosing(),
  );

  protected readonly firstNameDraft = signal('');
  protected readonly lastNameDraft = signal('');
  protected readonly birthDraft = signal<UiDateFieldParts | null>(null);
  protected readonly firstNameErrorCode = signal<string | null>(null);
  protected readonly lastNameErrorCode = signal<string | null>(null);
  protected readonly birthErrorCode = signal<string | null>(null);
  protected readonly saveErrorCode = signal<string | null>(null);

  protected readonly sheetTitleKey = computed(() => {
    const edit = this._editing();
    if (!edit) return null;
    return edit.profileEditField === ProfileEditField.Name
      ? 'account.profile.edit.nameTitle'
      : 'account.profile.edit.birthdayTitle';
  });
  protected readonly sheetLedeKey = computed(() => {
    const edit = this._editing();
    if (!edit) return null;
    return edit.profileEditField === ProfileEditField.Name
      ? 'account.profile.edit.nameLede'
      : 'account.profile.edit.birthdayLede';
  });

  /** Save is live only when the draft is both VALID and CHANGED — a no-op
   *  save never round-trips Firestore, and the button reads like Apple's
   *  "Done stays dim until you actually edited something". */
  protected readonly canSave = computed(() => {
    const edit = this._editing();
    const user = this.account();
    if (!edit || !user) return false;
    if (edit.profileEditField === ProfileEditField.Name) {
      const first = this.firstNameDraft();
      const last = this.lastNameDraft();
      const refused = nameRefusalCodes(first, last);
      if (refused.firstName !== null || refused.lastName !== null) {
        return false;
      }
      return first.trim() !== user.firstName || last.trim() !== user.lastName;
    }
    const parts = this.birthDraft();
    if (!parts) return false;
    const result = AgeSystem.fromParts(parts, this.ageDay);
    if (!result.ok) return false;
    return result.value !== user.birthDate;
  });

  constructor() {
    // `account` is live, so a write elsewhere (onboarding's birthday step)
    // is already here. This only re-attaches a listener that stopped on a
    // failure — a no-op while it is healthy — so entering the screen is one
    // fresh attempt.
    this.accountState.refresh();
  }

  protected openEditor(edit: ProfileEdit): void {
    if (this._editing()) return;
    const user = this.account();
    if (!user) return;
    // Seed eagerly rather than lazily so one editor's abandoned draft can
    // never bleed into the next one's fields.
    this.firstNameDraft.set(user.firstName ?? '');
    this.lastNameDraft.set(user.lastName ?? '');
    this.birthDraft.set(toDateFieldParts(user));
    this.firstNameErrorCode.set(null);
    this.lastNameErrorCode.set(null);
    this.birthErrorCode.set(null);
    this.saveErrorCode.set(null);
    this._editing.set(edit);
    this._sheetClosing.set(false);
  }

  protected requestClose(): void {
    // On the server the exit transition never fires `closeFinished`, so
    // the sheet would latch closing forever.
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this._editing() || this._sheetClosing()) return;
    // A write in flight refuses every dismissal — Escape, backdrop, drag,
    // close chip — so a save can never be orphaned against a torn-down
    // draft. Save's own loading state makes the refusal legible.
    if (this.store.pending()) return;
    this._sheetClosing.set(true);
  }

  protected finishClose(): void {
    if (!this._sheetClosing()) return;
    this._editing.set(null);
    this._sheetClosing.set(false);
  }

  /* ── Validation (reward early, punish late — onboarding's grammar) ─── */

  protected onFirstNameBlur(): void {
    this.firstNameErrorCode.set(this.nameRefusals().firstName);
  }

  protected onLastNameBlur(): void {
    this.lastNameErrorCode.set(this.nameRefusals().lastName);
  }

  protected onFirstNameInput(value: string): void {
    this.firstNameDraft.set(value);
    if (this.firstNameErrorCode() && this.nameRefusals().firstName === null) {
      this.firstNameErrorCode.set(null);
    }
  }

  protected onLastNameInput(value: string): void {
    this.lastNameDraft.set(value);
    if (this.lastNameErrorCode() && this.nameRefusals().lastName === null) {
      this.lastNameErrorCode.set(null);
    }
  }

  /** The two drafts through the ONE name rule the write enforces. */
  private nameRefusals() {
    return nameRefusalCodes(this.firstNameDraft(), this.lastNameDraft());
  }

  protected onBirthBlur(event: UiDateFieldBlurEvent): void {
    if (event.uiDateFieldFill !== UiDateFieldFill.Complete) {
      // An empty field is the untouched state, not an error; a partial one
      // is mid-typing. Neither deserves a red line.
      this.birthErrorCode.set(null);
      return;
    }
    const result = AgeSystem.fromParts(event.parts, this.ageDay);
    this.birthErrorCode.set(result.ok ? null : result.error.errorCode);
  }

  protected translateError(code: string | null): string | null {
    return code
      ? translateDomainError(this.transloco, { errorCode: code })
      : null;
  }

  /* ── Commits ──────────────────────────────────────────────────────── */

  protected async save(): Promise<void> {
    const edit = this._editing();
    if (!edit || !this.canSave()) return;
    this.saveErrorCode.set(null);

    let code: string | null;
    if (edit.profileEditField === ProfileEditField.Name) {
      const refused = this.nameRefusals();
      if (refused.firstName !== null || refused.lastName !== null) return;
      code = await this.store.saveName(
        this.firstNameDraft().trim(),
        this.lastNameDraft().trim(),
      );
    } else {
      const parts = this.birthDraft();
      if (!parts) return;
      const birthDate = AgeSystem.fromParts(parts, this.ageDay);
      if (!birthDate.ok) {
        this.birthErrorCode.set(birthDate.error.errorCode);
        return;
      }
      code = await this.store.saveBirthDate(birthDate.value);
    }

    if (code) {
      // The sheet stays open with the draft intact — a failed write must
      // never cost the user their typing.
      this.saveErrorCode.set(code);
      return;
    }
    this.requestClose();
  }

  protected async onPhotoPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.photoErrorCode.set(null);
    const code = await this.store.uploadPhoto(file);
    if (code) {
      this.photoErrorCode.set(code);
      return;
    }
    const previous = this.photoPreviewUrl();
    if (previous) URL.revokeObjectURL(previous);
    this.photoRemoved.set(false);
    this.photoPreviewUrl.set(URL.createObjectURL(file));
  }

  protected async removePhoto(): Promise<void> {
    this.photoErrorCode.set(null);
    const code = await this.store.removePhoto();
    if (code) {
      this.photoErrorCode.set(code);
      return;
    }
    const previous = this.photoPreviewUrl();
    if (previous) URL.revokeObjectURL(previous);
    this.photoPreviewUrl.set(null);
    this.photoRemoved.set(true);
  }

  /** Whether the dashboard-style nudge still applies — drives nothing on
   *  this screen's chrome, but keeps the "Add" affordance honest. */
  protected readonly isComplete = computed(() => {
    const user = this.account();
    if (!user) return false;
    return ProfileCompletionSystem.completion(user, this.portraitUrl() !== null)
      .complete;
  });
}

/** `User.birthDate` → the date field's three segments, or null when unset. */
function toDateFieldParts(user: User): UiDateFieldParts | null {
  return user.birthDate === null ? null : BirthDate.partsOf(user.birthDate);
}
