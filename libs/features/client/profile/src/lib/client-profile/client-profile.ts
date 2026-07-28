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
  FirstName,
  LastName,
  User,
  profileCompletion,
} from '@creativo/application/accounts';
import { BirthDate } from '@creativo/application/identity';
import { CLOCK } from '@creativo/application/shared';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  SessionIdentityService,
  SiteHeaderComponent,
} from '@creativo/features/shared/shell';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import {
  UiAvatar,
  UiButton,
  UiDateField,
  UiDateFieldBlurEvent,
  UiDateFieldParts,
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

/** Which value the sheet is currently editing. One editor at a time is not
 *  a policy but a fact — the sheet is modal, so no second row can be
 *  tapped while it is up; a union makes any other state unrepresentable. */
type ProfileEdit = { readonly kind: 'name' } | { readonly kind: 'birthday' };

/**
 * `/account/profile` — the personal-information surface (Apple's split:
 * *who you are* here, *how the app behaves* in the menu's locale/theme
 * chips). Read-only by default; tapping a row opens ONE modal sheet whose
 * body switches on what is being edited, with the close chip as cancel and
 * a docked action bar carrying Save — HIG's "self-contained subtask".
 *
 * Phone and email render as inert rows: changing either needs the two-step
 * `CONTACT_CHANGE_PORT` OTP flow, which has a port and a confirm use case
 * but no request use case yet. They carry no chevron and no interactive
 * grammar, so the screen never promises an affordance it can't honor.
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
    '[attr.data-state]': 'pageState()',
  },
})
export class ClientProfile {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transloco = inject(TranslocoService);
  private readonly clock = inject(CLOCK);

  protected readonly store = inject(ProfileStore);
  protected readonly accountState = inject(AccountStateService);
  protected readonly identity = inject(SessionIdentityService);
  protected readonly account = this.accountState.account;

  protected readonly pageState = computed(() => {
    if (this.accountState.accountLoading()) return 'loading';
    return this.account() ? 'ready' : 'empty';
  });

  private readonly today = (() => {
    const result = this.clock.now('UTC');
    return result.isSuccess() ? result.value : null;
  })();

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
  protected readonly fullName = computed(
    () => this.account()?.fullName() ?? this.identity.displayName(),
  );

  /* ── Rows ─────────────────────────────────────────────────────────── */

  protected readonly birthDateLabel = computed(() => {
    const birthDate = this.account()?.birthDate;
    if (!birthDate) return null;
    // Parse at LOCAL midnight — `new Date('1990-07-03')` is UTC midnight
    // and renders as the previous day in negative-offset zones.
    return new Intl.DateTimeFormat(this.transloco.getActiveLang(), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${birthDate.toISODate()}T00:00:00`));
  });

  protected readonly phoneLabel = computed(
    () => this.account()?.phone.formatInternational() ?? null,
  );
  protected readonly emailLabel = computed(
    () => this.account()?.email?.value ?? null,
  );

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
    return edit.kind === 'name'
      ? 'account.profile.edit.nameTitle'
      : 'account.profile.edit.birthdayTitle';
  });
  protected readonly sheetLedeKey = computed(() => {
    const edit = this._editing();
    if (!edit) return null;
    return edit.kind === 'name'
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
    if (edit.kind === 'name') {
      const first = FirstName.create(this.firstNameDraft());
      const last = LastName.create(this.lastNameDraft());
      if (first.isFailure() || last.isFailure()) return false;
      return (
        first.value.value !== user.firstName.value ||
        last.value.value !== user.lastName.value
      );
    }
    const parts = this.birthDraft();
    if (!parts || !this.today) return false;
    const result = BirthDate.create(parts, this.today);
    if (result.isFailure()) return false;
    return result.value.toISODate() !== (user.birthDate?.toISODate() ?? null);
  });

  constructor() {
    // `ProfilePort` is one-shot, so the shared snapshot is stale on entry
    // after any write elsewhere (onboarding's birthday step).
    this.accountState.refresh();
  }

  protected openEditor(edit: ProfileEdit): void {
    if (this._editing()) return;
    const user = this.account();
    if (!user) return;
    // Seed eagerly rather than lazily so one editor's abandoned draft can
    // never bleed into the next one's fields.
    this.firstNameDraft.set(user.firstName.value);
    this.lastNameDraft.set(user.lastName.value);
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
    const result = FirstName.create(this.firstNameDraft());
    this.firstNameErrorCode.set(result.isFailure() ? result.error.code : null);
  }

  protected onLastNameBlur(): void {
    const result = LastName.create(this.lastNameDraft());
    this.lastNameErrorCode.set(result.isFailure() ? result.error.code : null);
  }

  protected onFirstNameInput(value: string): void {
    this.firstNameDraft.set(value);
    if (this.firstNameErrorCode() && FirstName.create(value).isSuccess()) {
      this.firstNameErrorCode.set(null);
    }
  }

  protected onLastNameInput(value: string): void {
    this.lastNameDraft.set(value);
    if (this.lastNameErrorCode() && LastName.create(value).isSuccess()) {
      this.lastNameErrorCode.set(null);
    }
  }

  protected onBirthBlur(event: UiDateFieldBlurEvent): void {
    if (event.kind !== 'complete' || !this.today) {
      // An empty field is the untouched state, not an error; a partial one
      // is mid-typing. Neither deserves a red line.
      this.birthErrorCode.set(null);
      return;
    }
    const result = BirthDate.create(event.parts, this.today);
    this.birthErrorCode.set(result.isFailure() ? result.error.code : null);
  }

  protected translateError(code: string | null): string | null {
    return code ? translateDomainError(this.transloco, { code }) : null;
  }

  /* ── Commits ──────────────────────────────────────────────────────── */

  protected async save(): Promise<void> {
    const edit = this._editing();
    if (!edit || !this.canSave()) return;
    this.saveErrorCode.set(null);

    let code: string | null;
    if (edit.kind === 'name') {
      const first = FirstName.create(this.firstNameDraft());
      const last = LastName.create(this.lastNameDraft());
      if (first.isFailure() || last.isFailure()) return;
      code = await this.store.saveName(first.value, last.value);
    } else {
      const parts = this.birthDraft();
      if (!parts || !this.today) return;
      const birthDate = BirthDate.create(parts, this.today);
      if (birthDate.isFailure()) {
        this.birthErrorCode.set(birthDate.error.code);
        return;
      }
      code = await this.store.saveBirthDate(birthDate.value.toISODate());
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
    return profileCompletion(user, this.portraitUrl() !== null).complete;
  });
}

/** `User.birthDate` → the date field's three segments, or null when unset. */
function toDateFieldParts(user: User): UiDateFieldParts | null {
  const iso = user.birthDate?.toISODate();
  if (!iso) return null;
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return null;
  return { day: Number(day), month: Number(month), year: Number(year) };
}
