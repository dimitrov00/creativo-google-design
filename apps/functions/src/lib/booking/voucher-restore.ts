import type {
  DocumentReference,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { Money } from '@creativo/domain/kernel';
import type { GiftVoucher } from '@creativo/domain/engagement';
import { giftVoucherFromDocument } from '@creativo/application/engagement';
import {
  type GiftVoucherEntity,
  GiftVoucherId,
  type Money as MoneyData,
  UserId,
  VoucherCode,
  VoucherState,
  VoucherSystem,
} from '@creativo/ecs-core';

/*
 * THIN SHIM (ECS migration Phase 2) — the math only. What a cancellation puts
 * back on a voucher is `VoucherSystem.restore` (never above what was issued,
 * allowed on a void or expired voucher); the reads and writes stay here.
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

function toMoneyData(money: Money): MoneyData {
  return {
    amountMinorUnits: money.toMinorUnits(),
    currencyCode: money.currencyCode(),
  };
}

function toVoucherData(voucher: GiftVoucher): GiftVoucherEntity {
  const state = voucher.state;
  return {
    id: GiftVoucherId.of(voucher.id.value),
    code: VoucherCode.of(voucher.code),
    initialValue: toMoneyData(voucher.initialValue),
    balance: toMoneyData(voucher.balance),
    issuedAtMs: voucher.issuedAt.toMillis(),
    expiresAtMs:
      voucher.expiresAt === null ? null : voucher.expiresAt.toMillis(),
    issuedToUserId:
      voucher.issuedToUserId === null
        ? null
        : UserId.of(voucher.issuedToUserId.value),
    state:
      state.kind === 'void'
        ? VoucherState.voided(state.voidedAt.toMillis(), state.reason)
        : VoucherState.active(),
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
      balanceMinorUnits: restored.value.balance.amountMinorUnits,
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
