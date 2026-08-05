import {
  WaitlistRequest,
  type WaitlistRequestProps,
  type WaitlistStatus,
} from '@creativo/domain/scheduling';

/**
 * The waitlist request's persisted shape — shared by both SDKs, like every
 * document module in this folder: the `requestWaitlist` callable writes it
 * with the Admin SDK, the matcher re-reads it, and the BROWSER now reads it
 * too (the match notification deep-links back into `/book`, and landing that
 * link means reconstituting the request's bag client-side). Two parsers for
 * one shape is two opinions about what somebody asked to be told about.
 */
export const WAITLIST_COLLECTION = 'waitlistRequests';

export function waitlistToDocument(
  request: WaitlistRequest,
): Record<string, unknown> {
  const props = request.toProps();
  return {
    ...props,
    // `array-contains` needs a flat array of scalars.
    dayKeys: props.when.days.map((day) => day.dayKey),
    // Denormalized for the rules and the owner's own listing query.
    ownerUserId: props.ownerId,
  };
}

export function waitlistFromDocument(
  id: string,
  data: Record<string, unknown>,
): WaitlistRequest | null {
  const props = {
    id,
    ownerId: String(data['ownerId'] ?? ''),
    locationId: data['locationId'] == null ? null : String(data['locationId']),
    when: data['when'],
    cart: data['cart'],
    status: String(data['status'] ?? 'open') as WaitlistStatus,
    createdAtIso: String(data['createdAtIso'] ?? ''),
    zone: String(data['zone'] ?? ''),
  } as WaitlistRequestProps;

  const result = WaitlistRequest.reconstitute(props);
  return result.isSuccess() ? result.value : null;
}
