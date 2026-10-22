/*
 * The staff edit's two discriminator dictionaries — the call component
 * `BookingCall.EditCommand` types with them, so they live in the components
 * tier (Law 8: a component imports primitives only; moved here from
 * `appointment-edit.system.ts`, Phase 4a 4A-6).
 */

/** The staff edit commands — the field `editCommand`, the ONLY source of these strings. */
export const EditCommand = {
  Move: 'MOVE',
  Resize: 'RESIZE',
  Reprice: 'REPRICE',
  Redurate: 'REDURATE',
  Restaff: 'RESTAFF',
  AddSeat: 'ADD_SEAT',
  RemoveSeat: 'REMOVE_SEAT',
  Relocate: 'RELOCATE',
  Discounts: 'DISCOUNTS',
  Vouchers: 'VOUCHERS',
} as const;
export type EditCommand = (typeof EditCommand)[keyof typeof EditCommand];

/** Which handle of the block a resize drags — the field `resizeEdge`. */
export const ResizeEdge = {
  Start: 'START',
  End: 'END',
} as const;
export type ResizeEdge = (typeof ResizeEdge)[keyof typeof ResizeEdge];
