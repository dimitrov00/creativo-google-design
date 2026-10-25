import { CouponGrantId } from '@core/primitives';
import { describe, expect, it } from 'vitest';
import type { ClientCardGrant } from './client-card.contracts';
import { glanceReward } from './loyalty.presenter';
import { GEORGI_GRANT, TODAY, wordsOf } from '../testing/client-card.fixtures';

const WORDS = wordsOf('bg');

describe('ready rewards', () => {
  const beard: ClientCardGrant = {
    grantId: CouponGrantId.of('grant-beard'),
    title: 'Безплатно оформяне на брада',
    valueLabel: 'Безплатна услуга',
    expiresOn: null,
  };

  it('shows the glance one ticket, saying how many other kinds are held', () => {
    expect(glanceReward([beard, GEORGI_GRANT], TODAY, WORDS)).toMatchObject({
      grantId: 'grant-dev-georgi-punch',
      detail: 'до 28.10 · още 1',
    });
    expect(glanceReward([beard], TODAY, WORDS)?.detail).toBeNull();
    expect(glanceReward([], TODAY, WORDS)).toBeNull();
  });
});
