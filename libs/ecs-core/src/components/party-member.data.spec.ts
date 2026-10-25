import { describe, expect, it } from 'vitest';
import { GuestId, UserId } from '@core/primitives';
import { PartyMember, PartyRole } from './party-member.data';
import { SeatLabel } from './seat-label.data';

describe('PartyMember — each member built from its tag', () => {
  it('builds the owner, a companion and a guest', () => {
    expect(PartyMember.owner()).toEqual({ partyRole: PartyRole.Owner });
    expect(PartyMember.companion(UserId.of('u-2'))).toEqual({
      partyRole: PartyRole.Companion,
      companionUserId: 'u-2',
    });
    expect(
      PartyMember.guest(GuestId.of('guest-0'), SeatLabel.of('Мария')),
    ).toEqual({
      partyRole: PartyRole.Guest,
      guestId: 'guest-0',
      guestLabel: 'Мария',
    });
  });
});
