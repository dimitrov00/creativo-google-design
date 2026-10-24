import { Injectable, inject } from '@angular/core';
import { AccountStateService } from '@creativo/features/client/account-state';
import { GATEWAY_PORTS } from '@creativo/infrastructure/firebase-app';
import type { BookingContact } from '@core/components';
import { saveOwnProfile } from '@core/pipelines';
import { ProfileEditSystem } from '@core/systems';

/**
 * The contact sheet's one write — «save to profile» — so the sheet itself
 * only owns its drafts and sheet state (Law 8.2: a store, not a component,
 * consumes a pipeline). Provided by `BookingContactSheet` for its own life.
 */
@Injectable()
export class BookingContactStore {
  private readonly accountState = inject(AccountStateService);
  private readonly saveProfile = saveOwnProfile(inject(GATEWAY_PORTS));

  /**
   * `true` once the profile carries the typed NAME.
   *
   * The edit goes through the `updateProfile` callable (`saveOwnProfile`):
   * the server judges it with `ProfileEditSystem` against the stored profile
   * inside its transaction, so a value the profile would refuse never
   * reaches the document, and it writes the audit row in the same breath.
   * Only the names travel — the birth date is kept (`null`), and the phone
   * and e-mail are the account's, never the typed ones. No refresh
   * afterwards: `account` is the live `users/{uid}` listener, so the review
   * row behind the sheet shows the new name as soon as the write lands.
   */
  async writeProfileName(contact: BookingContact.Present): Promise<boolean> {
    const user = this.accountState.account();
    if (!user) return false;
    const name = ProfileEditSystem.nameFromFull(
      contact.contactName,
      user.lastName,
    );
    if (name === null) return false;

    const code = await this.saveProfile({
      firstName: name.firstName,
      lastName: name.lastName,
      birthDate: null,
    });
    return code === null;
  }
}
