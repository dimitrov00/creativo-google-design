import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  translateCodedError,
  loadedLanguage,
} from '@creativo/infrastructure/i18n';
import { BookingContact, type CountryIso2, type E164 } from '@core/components';
import { Profile } from '@core/entities';
import type { OwnProfileWriteFailure, SchedulingError } from '@core/errors';
import { ProfileEditSystem } from '@core/systems';
import {
  UiButton,
  UiModalSheet,
  UiPhoneField,
  UiSwitch,
  UiTextField,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import { BookingContactStore } from './booking-contact.store';

/**
 * Who the shop calls about THIS booking — edited in a sheet, over the review
 * step rather than away from it.
 *
 * ### Why a sheet and not a trip to the profile
 * The edit is scoped to the task the user is in the middle of. HIG reserves a
 * navigation push for "leave this and go elsewhere"; a sheet is what a
 * side-decision inside a task looks like, and it is what Apple Pay's own
 * contact row opens.
 *
 * ### One-time by default
 * What is typed here rides along with the booking as a SNAPSHOT and changes
 * nothing about the account (see `BookingContact`). That is the honest
 * default: a person booking from a colleague's phone, or giving the landline
 * of the office they will be at, is not renaming themselves.
 *
 * ### The switch saves the NAME, and says so (FIX 2, 2026-09-25)
 * The 2026-08-05 ruling had the switch save the whole form, so it would not
 * be "a lie with a toggle". The owner may edit only their names and birth
 * date on the profile, and only through the `updateProfile` callable (the
 * `users` document takes no client write, Phase 4a 4A-3 (2)); a phone or
 * e-mail is the account's login, not something this sheet can change. So
 * the switch is worded for what it can do — save the name — and appears
 * only while saving it would change the profile's. A typed phone or e-mail
 * that differs gets one quiet line: it applies to this booking only. The
 * callable writes the profile-change audit row itself, credited to the
 * person, in the same transaction as the edit.
 *
 * Ownership never moves either way: whatever name and number are entered,
 * the appointment belongs to the signed-in account, which remains the only
 * thing deciding who may see or cancel it.
 */
@Component({
  selector: 'lib-booking-contact-sheet',
  templateUrl: './booking-contact-sheet.html',
  styleUrl: './booking-contact-sheet.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [
    TranslocoDirective,
    UiButton,
    UiForegroundStyleDirective,
    UiListGroup,
    UiListRow,
    UiModalSheet,
    UiPhoneField,
    UiSheetActionBar,
    UiStack,
    UiSwitch,
    UiTextDirective,
    UiTextField,
  ],
  host: { 'data-testid': 'booking-contact-sheet' },
  providers: [BookingContactStore],
})
export class BookingContactSheet {
  private readonly transloco = inject(TranslocoService);
  private readonly accountState = inject(AccountStateService);
  private readonly contactStore = inject(BookingContactStore);

  /** What the booking already carries — `BookingContact.NONE` before anything is captured. */
  readonly uiContact = input<BookingContact>(BookingContact.NONE);
  readonly uiDefaultCountry = input<CountryIso2 | null>(null);
  readonly uiLocale = input('bg');

  readonly saved = output<BookingContact.Present>();
  readonly dismissed = output<void>();

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly phone = signal<string | null>(null);
  protected readonly phoneCountry = signal<CountryIso2 | null>(null);
  protected readonly saveToProfile = signal(false);
  protected readonly pending = signal(false);

  /** The contact the domain refused (`BookingContact.create`), as its struct (pass D E-12). */
  private readonly contactRefusal = signal<SchedulingError | null>(null);
  /** The «save to profile» write that failed, as its struct (pass D E-12). */
  private readonly profileFailure = signal<OwnProfileWriteFailure | null>(null);

  /**
   * The language the catalogue has LOADED, once it has: the error line is
   * worded from it, so no lookup inside the `computed` can start a load
   * (the visits pages read their words the same way).
   */
  private readonly loadedLang = toSignal(loadedLanguage(this.transloco), {
    initialValue: null,
  });

  /**
   * The error line, worded from the struct held (pass D DEP-23) — so a line
   * shown re-words when the language changes: a refused contact in its own
   * words (`errors.<errorCode>`, its fields the params), a failed profile
   * write as the sheet's own `booking.contact.profileFailed` (the booking
   * contact itself is still usable — only the profile write failed).
   */
  protected readonly error = computed((): string | null => {
    const lang = this.loadedLang();
    if (lang === null) return null;
    const refused = this.contactRefusal();
    if (refused !== null) return translateCodedError(this.transloco, refused);
    return this.profileFailure() === null
      ? null
      : this.transloco.translate('booking.contact.profileFailed', {}, lang);
  });

  constructor() {
    // Seed from what the booking carries, falling back to the account. The
    // sheet is created on open and destroyed on close, so this runs once per
    // visit — an abandoned edit never survives as a half-typed name.
    effect(() => {
      const carried = this.uiContact();
      const user = this.accountState.account();
      this.name.set(
        carried.contactName ?? (user === null ? '' : Profile.fullName(user)),
      );
      this.email.set(carried.contactEmail ?? user?.email ?? '');
      this.phone.set(carried.contactPhone ?? user?.phone ?? null);
      void this.seedCountry(user?.phone ?? null);
    });
  }

  /** Which seeding is the latest — an older one landing late is dropped. */
  private countrySeeding = 0;

  /** A save in flight — a second tap while the phone rules load is dropped. */
  private saving = false;

  /**
   * The stored E.164's country, as the phone field names it (`null` when it
   * cannot be placed) — read with the lazily loaded phone rules.
   */
  private async seedCountry(phone: E164 | null): Promise<void> {
    const seeding = ++this.countrySeeding;
    if (phone === null) {
      this.phoneCountry.set(null);
      return;
    }
    const { PhoneSystem } = await loadPhoneRules();
    if (seeding !== this.countrySeeding) return;
    this.phoneCountry.set(PhoneSystem.countryOf(phone));
  }

  protected readonly canSave = computed(
    () => this.name().trim().length > 0 && this.phone() !== null,
  );

  /**
   * Whether there is a name to save: the switch is offered only while the
   * save would CHANGE the profile — the typed name split exactly as the
   * write splits it (`ProfileEditSystem.nameFromFull`), compared field by
   * field (`ProfileEditSystem.namesChanged`). A single word keeps the stored
   * surname, so «Иван» over «Иван Петров» saves nothing and offers nothing.
   * No profile, nothing to save to.
   */
  protected readonly nameDiffers = computed(() => {
    const user = this.accountState.account();
    if (user === null) return false;
    const next = ProfileEditSystem.nameFromFull(this.name(), user.lastName);
    return (
      next !== null &&
      ProfileEditSystem.namesChanged(user, next.firstName, next.lastName)
    );
  });

  /**
   * Whether the typed phone or e-mail stray from the profile's — the cue for
   * the footnote that they apply to this booking only. A number still being
   * typed (`phone` is `null` until valid) counts as a change.
   */
  protected readonly contactDiffers = computed(() => {
    const user = this.accountState.account();
    if (!user) return false;
    const typedEmail = this.email().trim().toLowerCase();
    return this.phone() !== user.phone || typedEmail !== (user.email ?? '');
  });

  /**
   * Validate through the DOMAIN, never through a second copy of its rules:
   * the same `BookingContact.create` the server runs, with the same phone
   * rules (`PhoneSystem.parse`, loaded on first use), so a value this sheet
   * accepts is a value the commit accepts.
   */
  protected async save(): Promise<void> {
    if (this.pending() || this.saving) return;
    this.saving = true;
    try {
      await this.saveContact();
    } finally {
      this.saving = false;
    }
  }

  private async saveContact(): Promise<void> {
    this.contactRefusal.set(null);
    this.profileFailure.set(null);

    const { PhoneSystem } = await loadPhoneRules();
    const result = BookingContact.create(
      {
        name: this.name(),
        phone: this.phone() ?? '',
        email: this.email(),
        // The note is the VISIT's, edited in its own place on the review
        // step — this sheet neither shows nor loses it.
        note: this.uiContact().contactNote,
      },
      (raw) => {
        const parsed = PhoneSystem.parse(raw, null);
        return parsed.ok ? parsed.value.e164 : null;
      },
    );
    if (!result.ok) {
      this.contactRefusal.set(result.error);
      return;
    }
    const contact = result.value;

    // Only while the switch is on screen: a name typed back to the profile's
    // own hides it, and a hidden switch must not still write.
    if (this.saveToProfile() && this.nameDiffers()) {
      this.pending.set(true);
      const written = await this.contactStore.writeProfileName(contact);
      this.pending.set(false);
      if (!written.ok) {
        // The BOOKING contact is still perfectly usable; only the profile
        // write failed. Saying so and staying put beats silently keeping
        // half of what was asked for.
        this.profileFailure.set(written.error);
        return;
      }
    }

    this.saved.emit(contact);
  }
}

/** The phone rules, on first use — see `phone.lazy.ts`. */
const loadPhoneRules = () => import('./phone.lazy');
