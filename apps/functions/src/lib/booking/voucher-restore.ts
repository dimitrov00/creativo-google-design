import type {
  DocumentReference,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { Money } from '@creativo/domain/kernel';
import type { GiftVoucher } from '@creativo/domain/engagement';
import { giftVoucherFromDocument } from '@creativo/application/engagement';
import type { ZonedDateTime } from '@creativo/domain/kernel';
import {
  Currency,
  type GiftVoucher as GiftVoucherData,
  GiftVoucherId,
  type LocalDate,
  type Money as MoneyData,
  PriceCents,
  UserId,
  UtcEpochMs,
  VoucherCode,
  VoucherLifecycle,
  VoucherSystem,
  ZonedTimeSystem,
  defect,
} from '@creativo/ecs-core';

/*
 * THIN SHIM (ECS migration Phase 2) — the math only. What a cancellation puts
 * back on a voucher is `VoucherSystem.restore` (never above what was issued,
 * allowed on a void or expired voucher); the reads and writes stay here. The
 * legacy voucher converts at this boundary (flatten-spec §8.9): `Money` →
 * `*Cents` beside one `currency`, a `ZonedDateTime` → its instant and its
 * shop day on its own zone's clock.
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  // Unreachable: a legacy `Money` / `ZonedDateTime` already holds the rule.
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

function instantOf(at: ZonedDateTime): UtcEpochMs {
  return sure(UtcEpochMs.of(at.toMillis()), 'an instant');
}

function localDateOf(at: ZonedDateTime): LocalDate {
  return ZonedTimeSystem.toLocal(
    instantOf(at),
    sure(ZonedTimeSystem.checkZone(at.zoneName), 'a zone'),
  ).localDate;
}

function toMoneyData(money: Money): MoneyData {
  return {
    amountCents: sure(PriceCents.of(money.toMinorUnits()), 'an amount'),
    currency: sure(Currency.parse(money.currencyCode()), 'a currency'),
  };
}

function toVoucherData(voucher: GiftVoucher): GiftVoucherData {
  const state = voucher.state;
  const balance = toMoneyData(voucher.balance);
  return {
    id: GiftVoucherId.of(voucher.id.value),
    code: VoucherCode.of(voucher.code),
    initialValueCents: toMoneyData(voucher.initialValue).amountCents,
    balanceCents: balance.amountCents,
    currency: balance.currency,
    issuedAtUtcMs: instantOf(voucher.issuedAt),
    expiresAtUtcMs:
      voucher.expiresAt === null ? null : instantOf(voucher.expiresAt),
    expiresLocalDate:
      voucher.expiresAt === null ? null : localDateOf(voucher.expiresAt),
    issuedToUserId:
      voucher.issuedToUserId === null
        ? null
        : UserId.of(voucher.issuedToUserId.value),
    ...(state.kind === 'void'
      ? VoucherLifecycle.voided(instantOf(state.voidedAt), state.reason)
      : VoucherLifecycle.active()),
  };
}

/**
 * What a cancellation must give back: every gift voucher this visit drew on,
 * with the balance it returns to, and the visit's own redemption lines
 * marked reversed rather than deleted (the receipt is history).
 */
export interface VoucherRestorePlan {
  readonly restores: readonly {
    readonly ref: DocumentReference;
    readonly balanceMinorUnits: number;
  }[];
  /** The appointment's `voucherRedemptions`, every live line now reversed. */
  readonly voucherRedemptions: readonly unknown[];
}

/**
 * READ the vouchers a visit drew on — call it right after the appointment
 * itself is read and BEFORE any write in the transaction, because Firestore
 * wants every read to precede every write. `null` when the visit paid with
 * no voucher, which is nearly always.
 *
 * A voucher document that has gone missing, or one that would not take the
 * money back (over what it was issued with — a data error), is skipped: the
 * cancellation must still land, and the line is reversed on the visit so
 * nobody reads the money as still spent.
 */
export async function planVoucherRestore(
  tx: Transaction,
  db: Firestore,
  data: Record<string, unknown>,
  now: { iso: string; zone: string },
): Promise<VoucherRestorePlan | null> {
  const raw = Array.isArray(data['voucherRedemptions'])
    ? (data['voucherRedemptions'] as unknown[])
    : [];
  const isLive = (entry: unknown): entry is Record<string, unknown> =>
    entry != null &&
    typeof entry === 'object' &&
    (entry as Record<string, unknown>)['reversedAt'] == null;
  const live = raw.filter(isLive);
  if (live.length === 0) return null;

  const restores: { ref: DocumentReference; balanceMinorUnits: number }[] = [];
  for (const entry of live) {
    const ref = db.collection('giftVouchers').doc(String(entry['voucherId']));
    const snap = await tx.get(ref);
    const voucher = giftVoucherFromDocument(snap.id, snap.data());
    const amount = Money.fromMinorUnitsAndCode(
      Number(entry['amountMinorUnits']),
      String(entry['currencyCode'] ?? ''),
    );
    if (voucher === null || amount.isFailure()) continue;
    const restored = VoucherSystem.restore(
      toVoucherData(voucher),
      toMoneyData(amount.value),
    );
    if (!restored.ok) continue;
    restores.push({
      ref,
      balanceMinorUnits: restored.value.balanceCents,
    });
  }

  return {
    restores,
    voucherRedemptions: raw.map((entry) =>
      isLive(entry) ? { ...entry, reversedAt: now } : entry,
    ),
  };
}

/** WRITE the balances back — after the appointment's own update. */
export function applyVoucherRestore(
  tx: Transaction,
  plan: VoucherRestorePlan,
): void {
  for (const restore of plan.restores) {
    tx.update(restore.ref, { balanceMinorUnits: restore.balanceMinorUnits });
  }
}
