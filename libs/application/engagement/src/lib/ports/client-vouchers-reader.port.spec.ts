import { describe, expect, it } from 'vitest';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';
import { FIXTURE_TODAY } from '@core/testing';
import {
  InMemoryClientVouchersReader,
  giftVoucherFixtures,
} from '../../testing';
import { CLIENT_VOUCHERS_READER } from './client-vouchers-reader.port';

const GEORGI = 'dev-client-1';
const MARTIN = 'dev-client-2';

/** The fixtures' day at noon, in the shop's zone. */
const NOW = (() => {
  const parsed = ZonedDateTime.fromISO(
    `${FIXTURE_TODAY}T12:00:00.000+03:00`,
    'Europe/Sofia',
  );
  if (parsed.isFailure()) throw parsed.error;
  return parsed.value;
})();

/**
 * The port's reference (`@creativo/application/engagement/testing`), held
 * to the port's promises: the vouchers issued to an account, whatever
 * their state, and never a paper one.
 */
describe('ClientVouchersReader — the in-memory reference', () => {
  it('names its token', () => {
    expect(CLIENT_VOUCHERS_READER.toString()).toContain('ClientVouchersReader');
  });

  it('lists what the account was issued, whatever its state', async () => {
    const held =
      await InMemoryClientVouchersReader.seeded().listForHolder(GEORGI);
    if (held.isFailure()) throw held.error;
    expect(
      held.value
        .map((voucher) => [
          voucher.id.value,
          voucher.code,
          voucher.balance.toMinorUnits(),
          voucher.refusal(NOW),
        ])
        .sort(),
    ).toEqual([
      ['voucher-dev-georgi', 'GIFT50', 2500, null],
      ['voucher-dev-georgi-spent', 'SPENT20', 0, 'empty'],
      ['voucher-dev-georgi-void', 'VOID30', 3000, 'void'],
    ]);
    expect(
      held.value.every((voucher) => voucher.issuedToUserId?.value === GEORGI),
    ).toBe(true);
  });

  it('reads each voucher through the wire’s reader: money, dates, the holder', async () => {
    const held =
      await InMemoryClientVouchersReader.seeded().listForHolder(GEORGI);
    if (held.isFailure()) throw held.error;
    const gift = held.value.find((voucher) => voucher.code === 'GIFT50');
    expect(gift?.initialValue.toMinorUnits()).toBe(5000);
    expect(gift?.balance.currencyCode()).toBe('EUR');
    expect(gift?.expiresAt?.toISODate()).toBe('2026-12-31');
    expect(gift?.isRedeemable(NOW)).toBe(true);
  });

  it('keeps one person’s vouchers from another', async () => {
    const reader = InMemoryClientVouchersReader.seeded();
    const held = await reader.listForHolder(MARTIN);
    expect(
      held.isSuccess() && held.value.map((voucher) => voucher.code),
    ).toEqual(['GIFT2025']);
  });

  it('puts a paper voucher on nobody’s list', async () => {
    const reader = InMemoryClientVouchersReader.seeded();
    const everyone = await Promise.all(
      [GEORGI, MARTIN, '', 'null', 'undefined'].map((userId) =>
        reader.listForHolder(userId),
      ),
    );
    const codes = everyone.flatMap((held) =>
      held.isSuccess() ? held.value.map((voucher) => voucher.code) : [],
    );
    expect(codes).not.toContain('GIFT5');
    expect(codes).toHaveLength(4);
  });

  it('answers an empty list for a client who holds none', async () => {
    const seeded =
      await InMemoryClientVouchersReader.seeded().listForHolder('dev-client-9');
    const empty = await new InMemoryClientVouchersReader().listForHolder(
      GEORGI,
    );
    expect(seeded.isSuccess() && seeded.value).toEqual([]);
    expect(empty.isSuccess() && empty.value).toEqual([]);
  });

  it('issues a voucher, and replaces one under its id', async () => {
    const gift = giftVoucherFixtures['voucher-dev-georgi'];
    if (gift === undefined) throw new Error('fixture: no voucher');
    const reader = InMemoryClientVouchersReader.seeded()
      .put('voucher-new', { ...gift, code: 'NEW10', issuedToUserId: MARTIN })
      .put('voucher-dev-georgi', { ...gift, balanceMinorUnits: 1000 });
    const martin = await reader.listForHolder(MARTIN);
    const georgi = await reader.listForHolder(GEORGI);
    expect(
      martin.isSuccess() && martin.value.map((voucher) => voucher.code).sort(),
    ).toEqual(['GIFT2025', 'NEW10']);
    expect(
      georgi.isSuccess() &&
        georgi.value
          .find((voucher) => voucher.code === 'GIFT50')
          ?.balance.toMinorUnits(),
    ).toBe(1000);
  });

  it('leaves out a document that is no voucher, and keeps the rest', async () => {
    const reader = InMemoryClientVouchersReader.seeded()
      .put('voucher-broken', { issuedToUserId: GEORGI, code: 'BROKEN' })
      .put('voucher-worthless', {
        ...giftVoucherFixtures['voucher-dev-georgi'],
        code: 'ZERO',
        initialValueMinorUnits: 0,
      });
    const held = await reader.listForHolder(GEORGI);
    expect(
      held.isSuccess() && held.value.map((voucher) => voucher.code).sort(),
    ).toEqual(['GIFT50', 'SPENT20', 'VOID30']);
  });

  it('fails while told to, and records every read', async () => {
    const reader = InMemoryClientVouchersReader.seeded().failWith();
    const failed = await reader.listForHolder(GEORGI);
    expect(failed.isFailure() && failed.error).toBeInstanceOf(RepositoryError);
    reader.recover();
    expect((await reader.listForHolder(MARTIN)).isSuccess()).toBe(true);
    expect(reader.calls).toEqual([{ userId: GEORGI }, { userId: MARTIN }]);
  });
});
