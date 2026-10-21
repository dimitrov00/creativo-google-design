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
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  BookingContact,
  type BookingContactProps,
  MAX_BOOKING_NOTE_LENGTH,
} from '@creativo/application/booking';
import { CLOCK } from '@creativo/application/shared';
import { type CountryIso2, PhoneNumber } from '@creativo/application/identity';
import {
  AccountStateService,
  ageDayOf,
  saveOwnProfile,
} from '@creativo/features/client/account-state';
import { PROFILE_PORTS } from '@creativo/infrastructure/firebase-app';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import type { E164 } from '@core/components';
import { Profile, type User } from '@core/entities';
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
 * be "a lie with a toggle". The owner may now edit only their names and
 * birth date on the profile (the `users` allowlist); a phone or e-mail
 * changes only through the OTP contact-change callables, which prove the
 * person holds the new one. So the switch is worded for what it can do —
 * save the name — and appears only while saving it would change the
 * profile's. A typed phone or e-mail that differs gets one quiet line: it
 * applies to this booking only. Every profile change is audited server-side
 * by the `auditProfileChanges` trigger, actor and fields included.
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
})
export class BookingContactSheet {
  private readonly transloco = inject(TranslocoService);
  private readonly accountState = inject(AccountStateService);
  private readonly profilePorts = inject(PROFILE_PORTS);
  private readonly clock = inject(CLOCK);

  /** What the booking already carries, or `null` before anything is captured. */
  readonly uiContact = input<BookingContactProps | null>(null);
  readonly uiDefaultCountry = input<CountryIso2 | undefined>(undefined);
  readonly uiLocale = input('bg');

  readonly saved = output<BookingContactProps>();
  readonly dismissed = output<void>();

  protected readonly noteLimit = MAX_BOOKING_NOTE_LENGTH;

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly phone = signal<string | null>(null);
  protected readonly phoneCountry = signal<CountryIso2 | undefined>(undefined);
  protected readonly saveToProfile = signal(false);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Seed from what the booking carries, falling back to the account. The
    // sheet is created on open and destroyed on close, so this runs once per
    // visit — an abandoned edit never survives as a half-typed name.
    effect(() => {
      const carried = this.uiContact();
      const user = this.accountState.account();
      this.name.set(
        carried?.name ?? (user === null ? '' : Profile.fullName(user)),
      );
      this.email.set(carried?.email ?? user?.email ?? '');
      this.phone.set(carried?.phone ?? user?.phone ?? null);
      this.phoneCountry.set(phoneCountryOf(user?.phone ?? null));
    });
  }

  protected readonly canSave = computed(
    () => this.name().trim().length > 0 && this.phone() !== null,
  );

  /**
   * Whether there is a name to save: the switch is offered only while the
   * save would CHANGE the profile — the typed name split exactly as the
   * write splits it (`profileNameFrom`), compared field by field. A single
   * word keeps the stored surname, so «Иван» over «Иван Петров» saves
   * nothing and offers nothing. No profile, nothing to save to.
   */
  protected readonly nameDiffers = computed(() => {
    const user = this.accountState.account();
    if (user === null) return false;
    const next = profileNameFrom(this.name(), user);
    return (
      next !== null &&
      (next.firstName !== user.firstName || next.lastName !== user.lastName)
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
   * the same `BookingContact.create` the server runs, so a value this sheet
   * accepts is a value the commit accepts.
   */
  protected async save(): Promise<void> {
    if (this.pending()) return;
    this.error.set(null);

    const result = BookingContact.create({
      name: this.name(),
      phone: this.phone() ?? '',
      email: this.email(),
      // The note is the VISIT's, edited in its own place on the review step
      // — this sheet neither shows nor loses it.
      note: this.uiContact()?.note ?? null,
    });
    if (result.isFailure()) {
      this.error.set(translateDomainError(this.transloco, result.error));
      return;
    }
    const contact = result.value.toProps();

    // Only while the switch is on screen: a name typed back to the profile's
    // own hides it, and a hidden switch must not still write.
    if (this.saveToProfile() && this.nameDiffers()) {
      this.pending.set(true);
      const written = await this.writeProfile(contact);
      this.pending.set(false);
      if (!written) {
        // The BOOKING contact is still perfectly usable; only the profile
        // write failed. Saying so and staying put beats silently keeping
        // half of what was asked for.
        this.error.set(
          this.transloco.translate('booking.contact.profileFailed'),
        );
        return;
      }
    }

    this.saved.emit(contact);
  }

  /**
   * `true` once the profile carries the typed NAME.
   *
   * The owner write (`PROFILE_PORTS.writeOwnProfile`) judges the edit with
   * `ProfileEditSystem.decide` against the stored profile inside its
   * transaction — the one rule the server's `updateProfile` runs too — so a
   * value the profile would refuse never reaches the document. Phone and
   * e-mail are the STORED ones, never the typed: the write touches only the
   * owner's allowlist, and the search keys it derives index the contact
   * details the document actually holds. No refresh afterwards: `account`
   * is the live `users/{uid}` listener, so the review row behind the sheet
   * shows the new name as soon as the write lands.
   */
  private async writeProfile(contact: BookingContactProps): Promise<boolean> {
    const user = this.accountState.account();
    if (!user) return false;
    const name = profileNameFrom(contact.name, user);
    if (name === null) return false;

    // The birth-date age window (the stored date is re-judged) is checked
    // on the UTC day of the Clock port, never a raw Date (§7.1).
    const ageDay = ageDayOf(this.clock);
    if (ageDay === null) return false;

    const code = await saveOwnProfile(
      this.profilePorts,
      user.id,
      { firstName: name.firstName, lastName: name.lastName, birthDate: null },
      ageDay,
    );
    return code === null;
  }
}

/**
 * The profile name a typed name would be saved as — the ONE split both the
 * switch and the write use, so the switch can never promise a change the
 * save does not make.
 *
 * One name field, two domain values: everything up to the first space is the
 * given name, the rest the family name, spacing settled. A single-word name
 * keeps the surname the profile already had rather than erasing it. Case
 * stays — «иван» → «Иван» is exactly the correction someone saves. `null`
 * when nothing was typed.
 */
function profileNameFrom(
  typed: string,
  user: Pick<User, 'lastName'>,
): { readonly firstName: string; readonly lastName: string } | null {
  const [first, ...rest] = typed.trim().split(/\s+/);
  if (first === undefined || first.length === 0) return null;
  return {
    firstName: first,
    lastName: rest.length > 0 ? rest.join(' ') : (user.lastName ?? ''),
  };
}

/** The stored E.164's country, as the phone field names it (`undefined` when it cannot be placed). */
function phoneCountryOf(phone: E164 | null): CountryIso2 | undefined {
  if (phone === null) return undefined;
  const parsed = PhoneNumber.create(phone);
  return parsed.isSuccess() ? parsed.value.country : undefined;
}
