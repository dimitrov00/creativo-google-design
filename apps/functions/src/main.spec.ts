import { getApps } from 'firebase-admin/app';
import { logger } from 'firebase-functions';
import { type CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { Callables } from '@core/ports';
import * as main from './main';
import * as requestOtp from './lib/otp/request-otp';
import * as verifyOtp from './lib/otp/verify-otp';
import * as completeRegistration from './lib/otp/complete-registration';
import * as commitBooking from './lib/booking/commit-booking';
import * as cancelAppointment from './lib/booking/cancel-appointment';
import * as rescheduleAppointment from './lib/booking/reschedule-appointment';
import * as auditProfile from './lib/booking/audit-profile-changes';
import * as transitionAppointment from './lib/booking/transition-appointment';
import * as markArrived from './lib/booking/mark-arrived';
import * as clearArrival from './lib/booking/clear-arrival';
import * as recordSeatTip from './lib/booking/record-seat-tip';
import * as staffEditAppointment from './lib/booking/staff-edit-appointment';
import * as rebuildBusy from './lib/booking/rebuild-busy';
import * as rebuildCapacity from './lib/booking/rebuild-capacity';
import * as sampleLeadTime from './lib/booking/sample-lead-time';
import * as requestWaitlist from './lib/booking/request-waitlist';
import * as cancelWaitlist from './lib/booking/cancel-waitlist';
import * as matchWaitlist from './lib/booking/match-waitlist';
import * as dispatchProjections from './lib/clients/dispatch-client-projections';
import * as policyRecompute from './lib/clients/recompute-on-policy-change';
import * as runBackfill from './lib/ops/run-backfill';
import * as publishStreak from './lib/loyalty/publish-streak-definition';

/** The 29 deployed names — what `firebase.json`, the web and `verify:p0` know. */
const EXPORTS = [
  'auditProfileChanges',
  'cancelAppointment',
  'cancelWaitlist',
  'clearArrival',
  'commitBooking',
  'completeRegistration',
  'continueClientStatsPolicyRecompute',
  'dispatchClientProjections',
  'markArrived',
  'matchWaitlistOnBusyChange',
  'publishStreakDefinition',
  'rebuildBusyOnAppointmentChange',
  'rebuildCapacityOnBusyChange',
  'rebuildCapacityOnExceptionChange',
  'rebuildCapacityOnLocationChange',
  'rebuildCapacityOnRosterChange',
  'rebuildCapacityOnSettingsChange',
  'recomputeClientStatsOnPolicyChange',
  'recordSeatTip',
  'requestOtpChallenge',
  'requestWaitlist',
  'rescheduleAppointment',
  'runBackfill',
  'sampleBarberLeadTimeDaily',
  'staffEditAppointment',
  'sweepCapacityDaily',
  'sweepClientStatsPolicyDaily',
  'transitionAppointment',
  'verifyOtpChallenge',
] as const;

/** Today's definitions, export by export — what each deployed endpoint was declared as. */
const TODAY: Readonly<Record<(typeof EXPORTS)[number], unknown>> = {
  requestOtpChallenge: requestOtp.requestOtpChallenge,
  verifyOtpChallenge: verifyOtp.verifyOtpChallenge,
  completeRegistration: completeRegistration.completeRegistration,
  commitBooking: commitBooking.commitBooking,
  cancelAppointment: cancelAppointment.cancelAppointment,
  rescheduleAppointment: rescheduleAppointment.rescheduleAppointment,
  auditProfileChanges: auditProfile.auditProfileChanges,
  transitionAppointment: transitionAppointment.transitionAppointment,
  markArrived: markArrived.markArrived,
  clearArrival: clearArrival.clearArrival,
  recordSeatTip: recordSeatTip.recordSeatTip,
  staffEditAppointment: staffEditAppointment.staffEditAppointment,
  rebuildBusyOnAppointmentChange: rebuildBusy.rebuildBusyOnAppointmentChange,
  rebuildCapacityOnBusyChange: rebuildCapacity.rebuildCapacityOnBusyChange,
  rebuildCapacityOnExceptionChange:
    rebuildCapacity.rebuildCapacityOnExceptionChange,
  rebuildCapacityOnLocationChange:
    rebuildCapacity.rebuildCapacityOnLocationChange,
  rebuildCapacityOnRosterChange: rebuildCapacity.rebuildCapacityOnRosterChange,
  rebuildCapacityOnSettingsChange:
    rebuildCapacity.rebuildCapacityOnSettingsChange,
  sweepCapacityDaily: rebuildCapacity.sweepCapacityDaily,
  sampleBarberLeadTimeDaily: sampleLeadTime.sampleBarberLeadTimeDaily,
  requestWaitlist: requestWaitlist.requestWaitlist,
  cancelWaitlist: cancelWaitlist.cancelWaitlist,
  matchWaitlistOnBusyChange: matchWaitlist.matchWaitlistOnBusyChange,
  dispatchClientProjections: dispatchProjections.dispatchClientProjections,
  recomputeClientStatsOnPolicyChange:
    policyRecompute.recomputeClientStatsOnPolicyChange,
  continueClientStatsPolicyRecompute:
    policyRecompute.continueClientStatsPolicyRecompute,
  sweepClientStatsPolicyDaily: policyRecompute.sweepClientStatsPolicyDaily,
  runBackfill: runBackfill.runBackfill,
  publishStreakDefinition: publishStreak.publishStreakDefinition,
};

const exported = new Map<string, unknown>(Object.entries(main));
const endpointOf = (fn: unknown): unknown =>
  fn === null || typeof fn !== 'function'
    ? undefined
    : Reflect.get(fn, '__endpoint');

const unauthenticated = (data: unknown): CallableRequest<unknown> =>
  ({
    data,
    rawRequest: {},
    acceptsStreaming: false,
  }) as unknown as CallableRequest<unknown>;

/** A deployed function's `run` — what the platform (and a spec) invokes. */
type Runnable = { run: (input: unknown) => unknown };

const runnable = (fn: unknown): Runnable => fn as Runnable;

const CALLABLE_NAMES: ReadonlySet<string> = new Set(Object.values(Callables));

/** Today's handler of one export, by name. */
const todayOf = (name: string): Runnable =>
  runnable(new Map<string, unknown>(Object.entries(TODAY)).get(name));

async function rejection(promise: unknown): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpsError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('main.ts — the composition root', () => {
  it('exports exactly the 29 functions, by today’s names', () => {
    expect([...exported.keys()].sort()).toEqual([...EXPORTS]);
  });

  it('deploys every export as exactly the endpoint today’s definition declares', () => {
    for (const name of EXPORTS) {
      const ours = endpointOf(exported.get(name));
      expect(ours, name).toBeDefined();
      expect(ours, name).toEqual(
        endpointOf(new Map(Object.entries(TODAY)).get(name)),
      );
    }
  });

  it('exports every callable the web dials through the Callables registry, and no other callable', () => {
    const callables = EXPORTS.filter((name) => {
      const endpoint = endpointOf(exported.get(name));
      return (
        endpoint !== null &&
        typeof endpoint === 'object' &&
        'callableTrigger' in endpoint
      );
    });
    expect([...callables].sort()).toEqual(Object.values(Callables).sort());
  });

  it('keeps the trigger paths, retries and options of today', () => {
    const endpoint = (name: string): Record<string, unknown> =>
      endpointOf(exported.get(name)) as Record<string, unknown>;
    expect(endpoint('continueClientStatsPolicyRecompute')).toMatchObject({
      timeoutSeconds: 540,
      availableMemoryMb: 512,
      eventTrigger: {
        retry: true,
        eventFilters: { document: 'backfillJobs/clientStatsPolicy' },
      },
    });
    expect(endpoint('rebuildBusyOnAppointmentChange')).toMatchObject({
      eventTrigger: {
        retry: false,
        eventFilterPathPatterns: { document: 'appointments/{appointmentId}' },
      },
    });
    expect(endpoint('runBackfill')).toMatchObject({
      timeoutSeconds: 540,
      availableMemoryMb: 512,
      callableTrigger: {},
    });
    expect(endpoint('sweepCapacityDaily')).toMatchObject({
      scheduleTrigger: {
        schedule: 'every day 03:00',
        timeZone: 'Europe/Sofia',
        retryConfig: { retryCount: 3 },
      },
    });
    expect(endpoint('auditProfileChanges')).toMatchObject({
      eventTrigger: {
        retry: true,
        eventFilterPathPatterns: { document: 'users/{uid}' },
      },
    });
  });

  it('loads without initialising the Admin SDK — the Firestore and Auth bundles are built on first use', () => {
    expect(getApps()).toHaveLength(0);
  });

  describe('delegation — every export runs exactly its own handler', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Spies on all 29 of today's `run`s, each answering its own sentinel. */
    function spyOnEveryHandler() {
      const spies = new Map<string, ReturnType<typeof vi.fn>>();
      const sentinels = new Map<string, { readonly answeredBy: string }>();
      for (const name of EXPORTS) {
        const sentinel = { answeredBy: name };
        sentinels.set(name, sentinel);
        spies.set(
          name,
          vi
            .spyOn(todayOf(name), 'run')
            .mockResolvedValue(sentinel) as unknown as ReturnType<typeof vi.fn>,
        );
      }
      return { spies, sentinels };
    }

    it.each(EXPORTS)(
      '%s hands its input to its own handler — and to no other — and answers what it answers',
      async (name) => {
        const { spies, sentinels } = spyOnEveryHandler();
        const input = { probe: name };
        const answer = await runnable(exported.get(name)).run(input);
        expect(answer).toBe(sentinels.get(name));
        const own = spies.get(name);
        expect(own).toHaveBeenCalledTimes(1);
        expect(own?.mock.calls[0]?.[0]).toBe(input);
        for (const [other, spy] of spies) {
          if (other !== name)
            expect(spy, `${name} ran ${other}`).not.toHaveBeenCalled();
        }
      },
    );

    it.each(EXPORTS.filter((name) => CALLABLE_NAMES.has(name)))(
      '%s reports an unexpected throw under its own callable name',
      async (name) => {
        const trackError = vi
          .spyOn(logger, 'error')
          .mockImplementation(() => undefined);
        const thrown = new Error(`boom in ${name}`);
        vi.spyOn(todayOf(name), 'run').mockRejectedValue(thrown);
        const answer = await rejection(
          runnable(exported.get(name)).run(unauthenticated({})),
        );
        expect(answer.code).toBe('internal');
        expect(trackError).toHaveBeenCalledTimes(1);
        expect(trackError).toHaveBeenCalledWith(thrown, { callable: name });
      },
    );
  });

  it('delegates to today’s handler: its own HttpsError reaches the caller untouched', async () => {
    const run = (name: string, data: unknown) =>
      (
        exported.get(name) as { run: (r: CallableRequest<unknown>) => unknown }
      ).run(unauthenticated(data));
    const cancel = await rejection(run('cancelWaitlist', { requestId: 'r1' }));
    expect(cancel.code).toBe('unauthenticated');
    expect(cancel.message).toBe('Sign in to manage the waitlist');
    expect(cancel.details).toEqual({
      code: 'booking.waitlist.unauthenticated',
    });

    const tip = await rejection(run('recordSeatTip', {}));
    expect(tip.code).toBe('unauthenticated');
    expect(tip.details).toEqual({ code: 'booking.tip.unauthenticated' });
  });
});
