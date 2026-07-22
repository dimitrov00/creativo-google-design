import { Email } from '@creativo/domain/accounts';
import { PhoneNumber } from '@creativo/domain/kernel';

/** The new contact value a user wants to change to — replaces a bare `destination: string` + `'email' | 'phone'` pair. */
export type ContactChangeTarget =
  | { readonly kind: 'email'; readonly email: Email }
  | { readonly kind: 'phone'; readonly phone: PhoneNumber };
