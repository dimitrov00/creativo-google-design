import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { GiftVoucher } from '@creativo/domain/engagement';

/**
 * The persisted shape of a gift voucher — `giftVouchers/{id}` — defined
 * here, in the port layer, because two SDKs touch it: the browser reads a
 * code's worth through `firebase/firestore`, and the staff-edit transaction
 * draws the balance down through `firebase-admin`. Plain objects, no SDK.
 */
export type GiftVoucherDocument = Record<string, unknown>;

export function giftVoucherToDocument(
  voucher: GiftVoucher,
): GiftVoucherDocument {
  return {
    code: voucher.code,
    initialValueMinorUnits: voucher.initialValue.toMinorUnits(),
    balanceMinorUnits: voucher.balance.toMinorUnits(),
    currencyCode: voucher.balance.currencyCode(),
    issuedAt: {
      iso: voucher.issuedAt.toISO(),
      zone: voucher.issuedAt.zoneName,
    },
    expiresAt:
      voucher.expiresAt === null
        ? null
        : { iso: voucher.expiresAt.toISO(), zone: voucher.expiresAt.zoneName },
    issuedToUserId: voucher.issuedToUserId?.value ?? null,
    state:
      voucher.state.kind === 'void'
        ? {
            kind: 'void',
            voidedAt: {
              iso: voucher.state.voidedAt.toISO(),
              zone: voucher.state.voidedAt.zoneName,
            },
            reason: voucher.state.reason,
          }
        : { kind: 'active' },
  };
}

/** Document → `GiftVoucher`, or `null` for anything that is not one. */
export function giftVoucherFromDocument(
  id: string,
  data: GiftVoucherDocument | undefined,
): GiftVoucher | null {
  if (!data) return null;
  const currency = data['currencyCode'];
  const initial = data['initialValueMinorUnits'];
  const balance = data['balanceMinorUnits'];
  const code = data['code'];
  if (typeof currency !== 'string' || typeof code !== 'string') return null;
  if (typeof initial !== 'number' || typeof balance !== 'number') return null;
  const value = Money.fromMinorUnitsAndCode(initial, currency);
  const left = Money.fromMinorUnitsAndCode(Math.max(0, balance), currency);
  const issuedAt = zoned(data['issuedAt']);
  if (value.isFailure() || left.isFailure() || issuedAt === null) return null;

  const state = (data['state'] ?? {}) as Record<string, unknown>;
  const voidedAt = zoned(state['voidedAt']);
  const voucher = GiftVoucher.reconstitute({
    id,
    code,
    value: value.value,
    balance: left.value,
    issuedAt,
    expiresAt: zoned(data['expiresAt']),
    issuedToUserId:
      typeof data['issuedToUserId'] === 'string'
        ? data['issuedToUserId']
        : null,
    state:
      state['kind'] === 'void' && voidedAt !== null
        ? { kind: 'void', voidedAt, reason: String(state['reason'] ?? '') }
        : { kind: 'active' },
  });
  return voucher.isSuccess() ? voucher.value : null;
}

function zoned(raw: unknown): ZonedDateTime | null {
  if (raw == null || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const parsed = ZonedDateTime.fromISO(
    String(entry['iso'] ?? ''),
    String(entry['zone'] ?? ''),
  );
  return parsed.isSuccess() ? parsed.value : null;
}
