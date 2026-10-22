/**
 * Compile-only proofs over the flat booking draft (Phase 4a 4A-9): the
 * flow state, the contact slice, the origin and the day share no field
 * name, the draft is never `never`, the 1-to-1 fields of the contact slice
 * and of every origin variant are flat (`NoNested` — the flow state's own
 * bags are its component's), and `bookingDraftOrigin` narrows to exactly
 * its variant's fields. `tsc` failing IS the test; nothing here runs.
 */
import type { AllTrue, Disjoint, NoNested } from '@core/testing';
import type { BookingContact } from './booking-contact.data';
import { type BookingDraft, BookingDraftOrigin } from './booking-draft.data';
import type { BookingFlowState } from './booking-flow.data';

type IsNever<T> = [T] extends [never] ? true : false;
/** `true` when EVERY variant of the union is flat (distributes over `E`). */
type EveryVariantFlat<E> = E extends unknown ? AllTrue<NoNested<E>> : never;
type DraftDay = { readonly draftLocalDate: BookingDraft['draftLocalDate'] };

export const draftNotNever: IsNever<BookingDraft> = false;
export const draftDisjoint: [
  Disjoint<BookingFlowState, BookingContact>,
  Disjoint<BookingFlowState, BookingDraft.Origin>,
  Disjoint<BookingContact, BookingDraft.Origin>,
  Disjoint<BookingFlowState, DraftDay>,
  Disjoint<BookingContact, DraftDay>,
  Disjoint<BookingDraft.Origin, DraftDay>,
] = [true, true, true, true, true, true];
export const contactFlat: AllTrue<NoNested<BookingContact>> = true;
export const originFlat: EveryVariantFlat<BookingDraft.Origin> = true;

declare const draft: BookingDraft;
if (draft.bookingDraftOrigin === BookingDraftOrigin.Reschedule) {
  void draft.rescheduleRiders;
  void draft.rescheduleRelease;
  void draft.rescheduleLocalDate;
}
if (draft.bookingDraftOrigin === BookingDraftOrigin.BookedFrom) {
  void draft.bookedFromAppointmentId;
  // @ts-expect-error — a rebooking holds no move
  void draft.rescheduleRiders;
}
if (draft.bookingDraftOrigin === BookingDraftOrigin.Fresh) {
  // @ts-expect-error — a fresh draft holds no source
  void draft.bookedFromAppointmentId;
}
