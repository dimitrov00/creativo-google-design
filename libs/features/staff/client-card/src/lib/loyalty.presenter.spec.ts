import { CouponValue } from '@core/components';
import { CouponGrantId, CouponId } from '@core/primitives';
import { unwrapOk } from '@core/testing';
import { describe, expect, it } from 'vitest';
import type { ClientCardGrant } from './client-card.contracts';
import { glanceReward, groupedGrants } from './loyalty.presenter';
import { GEORGI_GRANT, TODAY, wordsOf } from '../testing/client-card.fixtures';

const WORDS = wordsOf('bg');
const ENGLISH = wordsOf('en');

describe('ready rewards', () => {
  const beard: ClientCardGrant = {
    grantId: CouponGrantId.of('grant-beard'),
    couponId: CouponId.of('coupon-free-beard'),
    value: CouponValue.freeService(),
    title: 'Безплатно оформяне на брада',
    valueLabel: 'Безплатна услуга',
    expiresOn: null,
    couponOccasion: null,
  };

  it('shows the glance one ticket, saying how many other kinds are held', () => {
    expect(glanceReward([beard, GEORGI_GRANT], TODAY, WORDS)).toMatchObject({
      grantId: 'grant-dev-georgi-punch',
      detail: 'до 28.10 · още 1',
    });
    expect(glanceReward([beard], TODAY, WORDS)?.detail).toBeNull();
    expect(glanceReward([], TODAY, WORDS)).toBeNull();
    expect(glanceReward([beard, GEORGI_GRANT], TODAY, ENGLISH)).toMatchObject({
      grantId: 'grant-dev-georgi-punch',
      detail: 'until 10/28 · 1 more',
    });
  });

  /** The tickets, each as its grants' ids. */
  const tickets = (ready: readonly ClientCardGrant[]) =>
    groupedGrants(ready, []).map((ticket) =>
      ticket.grants.map((grant) => grant.grantId),
    );

  it('keys a ticket by the coupon and the value it snapshotted, never by its words (OR-15, DEP-F11)', () => {
    // One coupon at one value: ONE ticket, the soonest (then the id) first.
    const twin: ClientCardGrant = {
      ...GEORGI_GRANT,
      grantId: CouponGrantId.of('grant-twin'),
    };
    expect(tickets([twin, GEORGI_GRANT])).toEqual([
      ['grant-dev-georgi-punch', 'grant-twin'],
    ]);
    // Two coupons that share a name: two tickets, as two rewards are.
    const namesake: ClientCardGrant = {
      ...GEORGI_GRANT,
      grantId: CouponGrantId.of('grant-namesake'),
      couponId: CouponId.of('coupon-other-cut'),
    };
    expect(tickets([GEORGI_GRANT, namesake])).toEqual([
      ['grant-dev-georgi-punch'],
      ['grant-namesake'],
    ]);
    expect(glanceReward([namesake, GEORGI_GRANT], TODAY, WORDS)?.detail).toBe(
      'до 28.10 · още 1',
    );
    // One coupon granted at two values: two promises, two tickets.
    const halfOff: ClientCardGrant = {
      ...GEORGI_GRANT,
      grantId: CouponGrantId.of('grant-half'),
      value: unwrapOk(CouponValue.percentOff(50)),
    };
    expect(tickets([GEORGI_GRANT, halfOff])).toEqual([
      ['grant-dev-georgi-punch'],
      ['grant-half'],
    ]);
  });

  it('keeps a grant on the bill a ticket of its own, where it stood', () => {
    const twin: ClientCardGrant = {
      ...GEORGI_GRANT,
      grantId: CouponGrantId.of('grant-twin'),
    };
    expect(
      groupedGrants([twin], [GEORGI_GRANT]).map((ticket) => ({
        grants: ticket.grants.map((grant) => grant.grantId),
        applied: ticket.applied,
      })),
    ).toEqual([
      { grants: ['grant-dev-georgi-punch'], applied: true },
      { grants: ['grant-twin'], applied: false },
    ]);
  });
});
