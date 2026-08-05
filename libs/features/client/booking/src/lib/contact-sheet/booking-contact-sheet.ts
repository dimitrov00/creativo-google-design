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
import { PROFILE_PORT, User } from '@creativo/application/accounts';
import { CLOCK } from '@creativo/application/shared';
import type { CountryIso2 } from '@creativo/application/identity';
import { AccountStateService } from '@creativo/features/client/account-state';
import { translateDomainError } from '@creativo/infrastructure/i18n';
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
 * ### The switch saves EVERYTHING it shows (owner ruling 2026-08-05)
 * An earlier pass persisted only the name, on the argument that phone/email
 * are login-adjacent. The owner overruled it: a switch that says "save to my
 * profile" and then saves a third of the form is a lie with a toggle. What
 * it writes is the PROFILE record — the login identifier lives in Firebase
 * Auth and is untouched from here, which is what the footnote now says.
 * Every profile change is audited server-side by the `auditProfileChanges`
 * trigger, actor and fields included.
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
  private readonly profile = inject(PROFILE_PORT);
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
      this.name.set(carried?.name ?? user?.fullName() ?? '');
      this.email.set(carried?.email ?? user?.email?.value ?? '');
      this.phone.set(carried?.phone ?? user?.phone.value ?? null);
      this.phoneCountry.set(user?.phone.country);
    });
  }

  protected readonly canSave = computed(
    () => this.name().trim().length > 0 && this.phone() !== null,
  );

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

    if (this.saveToProfile()) {
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
   * `true` once the profile says what the sheet says — name, phone AND
   * email.
   *
   * Rebuilt through `User.reconstitute`, the domain's own validating door,
   * so a value the profile would refuse never reaches the port. The write is
   * a plain profile save; the sign-in identifier lives in Firebase Auth and
   * is deliberately not touched from here. The `auditProfileChanges` trigger
   * records the change server-side, whatever path wrote it.
   */
  private async writeProfile(contact: BookingContactProps): Promise<boolean> {
    const user = this.accountState.account();
    if (!user) return false;

    // One name field, two domain values: everything up to the first space is
    // the given name, the rest the family name. A single-word name keeps the
    // surname the profile already had rather than erasing it.
    const [first, ...rest] = contact.name.trim().split(/\s+/);

    // The birth-date age window is checked against an explicit instant — the
    // Clock port, never a raw Date (§7.1).
    const today = this.clock.now('UTC');
    if (today.isFailure()) return false;

    const updated = User.reconstitute(
      {
        id: user.id.value,
        phone: contact.phone,
        firstName: first ?? user.firstName.value,
        lastName: rest.join(' ') || user.lastName.value,
        roles: [...user.roles],
        status: user.status,
        email: contact.email ?? undefined,
        birthDate: user.birthDate?.toISODate(),
      },
      today.value,
    );
    if (updated.isFailure()) return false;

    const saved = await this.profile.saveProfile(updated.value);
    if (saved.isFailure()) return false;

    // The account signal is what every other surface reads; refreshing it is
    // how the review row behind the sheet shows the new details.
    this.accountState.refresh();
    return true;
  }
}
