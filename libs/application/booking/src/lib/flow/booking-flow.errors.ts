import { BookingPartyError } from '@creativo/domain/scheduling';

/** Errors `advanceBookingFlow` can produce. */
export type BookingFlowError =
  | {
      readonly kind: 'invalid_transition';
      readonly from: string;
      readonly event: string;
    }
  | { readonly kind: 'invalid_guest'; readonly errors: BookingPartyError[] }
  | { readonly kind: 'guest_not_found'; readonly guestId: string }
  | { readonly kind: 'empty_services' };
