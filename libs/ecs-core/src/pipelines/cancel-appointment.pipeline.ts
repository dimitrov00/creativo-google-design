import type { Actor, CancellationReason, WriteOp } from '@core/components';
import {
  Result,
  type AppointmentId,
  type OperationId,
  type UserId,
} from '@core/primitives';
import {
  BookingError,
  type CancelAppointmentError,
  CancellationRefusalCode,
} from '@core/errors';
import type { Appointment, CouponGrant, GiftVoucher } from '@core/entities';
import type {
  AuditAppendPorts,
  PolicyReadPorts,
  TelemetryPorts,
  TxPorts,
} from '@core/ports';
import {
  type AuditFact,
  AppointmentLifecycleSystem,
  BillingSystem,
  CancellationPolicySystem,
} from '@core/systems';
import {
  appendAuditFacts,
  grantReleaseWrites,
  readAppointment,
  readDiscountGrants,
  readRedemptionVouchers,
  voucherRestoreWrites,
} from './booking-read-set.pipeline';

/**
 * `cancelAppointment` — the CLIENT calling off their own visit (blueprint
 * §4.1). The tenant's free-cancellation window is read OUTSIDE the
 * transaction (policy is tuning data and never widens a conflict set) and a
 * failed read REFUSES the cancel (`BOOKING_CANCEL_POLICY_UNAVAILABLE`):
 * here the window is the rule being enforced, and falling open would let a
 * late cancel through unjudged. Inside the transaction: the visit, the
 * vouchers its live redemption lines name and the coupon grants its bill's
 * grant lines name (`readDiscountGrants`, OR-13 — no grant line, no read);
 * then `CancellationPolicySystem.mayCancel` (the status graph — a terminal
 * visit refuses, which is also what makes a lost-response retry of a
 * committed cancel answer `not_cancellable` — and the window) and
 * `AppointmentLifecycleSystem.cancelByClient` (every open seat cancelled BY
 * THE CLIENT under the window it was allowed under, the root carrying the
 * code). ONE plan: the appointment's variant transition
 * (`WriteOp.transition` + `variantFieldsToDelete`) and, as the move
 * releases the visit's holdings (`BillingSystem.releasesHoldings`, the one
 * predicate the shop's pen reads too), the reversed voucher lines and the
 * bill with its grant lines dropped folded into it, beside each voucher's
 * restored balance and each grant's restore. The act's row goes
 * AFTER the commit, keyed by the instant it stamped
 * (`cancelled:<atUtcMs>`), naming everyone on the visit. No version CAS —
 * today's payload carries none (§4.1).
 */

export type CancelAppointmentCommand = {
  readonly appointmentId: AppointmentId;
  /** The verified caller — only the visit's owner may cancel it. */
  readonly callerUserId: UserId;
  /** The code the seats are filed under (code-only, §9 D23). */
  readonly reason: CancellationReason;
  /** The act's operation id — the client-minted name of this ONE act, REQUIRED (WS-4.1). */
  readonly operationId: OperationId;
  readonly actor: Actor | null;
};

export type CancelAppointmentAnswer = {
  readonly appointmentId: AppointmentId;
};

export type CancelAppointmentPorts = TxPorts &
  PolicyReadPorts &
  AuditAppendPorts &
  TelemetryPorts;

type Snapshot = {
  readonly appointment: Appointment | null;
  readonly vouchers: readonly GiftVoucher[];
  readonly grants: readonly CouponGrant[];
};

type Decided = {
  readonly auditFacts: readonly AuditFact[];
  readonly writes: readonly WriteOp[];
};

export const cancelAppointment =
  (ports: CancelAppointmentPorts) =>
  async (
    cmd: CancelAppointmentCommand,
  ): Promise<Result<CancelAppointmentAnswer, CancelAppointmentError>> => {
    const policy = await ports.loadPolicy();
    if (!policy.ok) {
      ports.log('warn', 'cancellation policy unread; cancel refused', {
        errorCode: CancellationRefusalCode.PolicyUnavailable,
        resourceId: cmd.appointmentId,
        error: policy.error.reason,
      });
      return Result.err({
        errorCode: CancellationRefusalCode.PolicyUnavailable,
      });
    }
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      async (tx): Promise<Snapshot> => {
        const appointment = await readAppointment(tx, cmd.appointmentId);
        if (
          appointment === null ||
          appointment.ownerUserId !== cmd.callerUserId
        ) {
          return { appointment: null, vouchers: [], grants: [] };
        }
        return {
          appointment,
          vouchers: await readRedemptionVouchers(
            tx,
            appointment.voucherRedemptions,
          ),
          grants: await readDiscountGrants(tx, appointment.discounts),
        };
      },
      (snapshot): Result<Decided, CancelAppointmentError> => {
        const appointment = snapshot.appointment;
        if (appointment === null) {
          return Result.err(BookingError.invalidInput('appointmentId'));
        }
        const allowed = CancellationPolicySystem.mayCancel(
          appointment,
          policy.value,
          nowUtcMs,
        );
        if (!allowed.ok) return allowed;
        const step = AppointmentLifecycleSystem.cancelByClient(
          appointment,
          cmd.reason,
          allowed.value.windowHours,
          nowUtcMs,
        );
        if (!step.ok) return step;
        return Result.ok({
          auditFacts: step.value.auditFacts,
          writes: BillingSystem.releasesHoldings(
            appointment,
            step.value.appointment,
          )
            ? grantReleaseWrites(
                voucherRestoreWrites(
                  step.value.writes,
                  appointment.voucherRedemptions,
                  snapshot.vouchers,
                  nowUtcMs,
                ),
                appointment.discounts,
                snapshot.grants,
              )
            : step.value.writes,
        });
      },
    );
    if (!committed.ok) return committed;
    await appendAuditFacts(ports, committed.value.auditFacts, cmd.actor);
    return Result.ok({ appointmentId: cmd.appointmentId });
  };
