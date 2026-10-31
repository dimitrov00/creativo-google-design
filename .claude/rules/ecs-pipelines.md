---
paths:
  - 'libs/ecs-core/src/pipelines/**'
  - '**/*.pipeline.ts'
  - '**/*.pipeline.spec.ts'
  - '**/*.port.ts'
  - '**/*.adapter.ts'
  - 'apps/functions/src/**'
  - 'apps/api/src/**'
---

# Pipelines, ports and adapters — the sandwich

Law 4 of `CLAUDE.md`. A pipeline is a use case: impure read, pure compute,
impure write. Nothing else lives in it.

## Ports are function types (`scheduling.port.ts`, `tx.port.ts`, `telemetry.port.ts`)

```ts
import type { BarberBusyDay } from '@core/entities';
import type { BookingPolicy, WriteOp } from '@core/components';
import type { RepositoryError } from '@core/errors';
import type { BusyKey, Result } from '@core/primitives';

export type LoadPolicy = () => Promise<Result<BookingPolicy, RepositoryError>>;
export type LoadBusyDay = (
  key: BusyKey,
) => Promise<Result<BarberBusyDay | null, RepositoryError>>;

/** The transactional sandwich: reads → pure decide → writes, atomically. */
export type CommitPlan = <S, D, E>(
  read: (tx: ReadTx) => Promise<S>,
  decide: (
    snapshot: S,
  ) => Result<D & { readonly writes: readonly WriteOp[] }, E>,
) => Promise<Result<D, E | RepositoryError>>;

// Illustrative: Law 4's task port — none exists yet; today's follow-up work
// rides the Firestore triggers on the committed write.
export type EnqueueTask = (task: BackgroundTask) => Promise<void>;

export type Log = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  fields?: Record<string, unknown>,
) => void;
export type TrackError = (
  error: unknown,
  context?: Record<string, unknown>,
) => void;
```

No interfaces with methods, no abstract classes, no `InjectionToken`s here.
Port functions are grouped in focused bundle records declared in the ports
tier and composed bottom-up with `&` (Law 9, `ecs-ports.md`); a pipeline's
dependency type is an intersection of named bundles —
`export type BookAppointmentPorts = TxPorts & WalkInKeyPorts &
PolicyReadPorts & AccountContactPorts & TelemetryPorts` — never a
`Pick`/`Omit` of a larger catalogue.
The sandwich derives the shop's `ShopNow` ONCE from `ports.nowUtcMs()` and
the location's `timeZone` (`ZonedTimeSystem.shopNow`) and hands that to the
systems.

## A pipeline (`book-appointment.pipeline.ts`)

```ts
export const bookAppointment =
  (ports: BookingPorts) =>
  async (
    cmd: BookAppointmentCommand,
  ): Promise<Result<{ appointmentId: AppointmentId }, BookingError>> => {
    // 1. impure read — through the port, raw component bags, no mapping
    // 2. pure compute — the system decides and returns a write plan
    // 3. impure write — the port commits the plan; tasks are enqueued after
    const result = await ports.commit(
      (tx) => loadBookingSnapshot(tx, cmd), // 1
      (snapshot) =>
        BookingSystem.decide(snapshot, cmd, {
          now: ZonedTimeSystem.shopNow(ports.nowUtcMs(), snapshot.timeZone),
          nextId: ports.nextId,
        }), // 2
    ); // 3
    if (!result.ok) {
      ports.log('warn', LogEvent.BookingRejected, {
        errorCode: result.error.errorCode,
      });
      return result;
    }
    await ports.enqueue({
      backgroundTask: 'NOTIFY_BOOKED',
      appointmentId: result.value.appointmentId,
    });
    return Result.ok({ appointmentId: result.value.appointmentId });
  };
```

- The example is schematic: `BookingSystem.decide` and `ports.enqueue` stand
  for the real system calls and the future task port. The real
  `book-appointment.pipeline.ts` reads through `readBookingSet` inside
  `ports.commit` and plans its audit rows inside the same decide step
  (`AuditSystem.commitWrites`), as `WriteOp.create` entries of the one
  commit plan — they land with the act or not at all; a fact with no
  verified actor is logged after the commit (`logUnaudited`). The follow-up
  work rides the triggers on the written document
  (`rebuildBusyOnAppointmentChange`, `dispatchClientProjections`).
- No business math inside the pipeline; if you are comparing intervals or
  summing money here, move it to a system.
- No SDK import (`firebase-admin`, `pino`, `@sentry/*`) inside a pipeline.
- `nowUtcMs`/`nextId` are ports so specs can pin them; `ShopNow` is derived
  from `nowUtcMs` once per request, never read inside a system.

## The ingestion boundary owns time (Law 7)

A pipeline that accepts a wall-clock time (a booking, a block, a move) loads
the location, reads its `timeZone`, and calls `ZonedTimeSystem` ONCE to
compute `utcEpochMs` — a spring-forward gap time returns the error
`DST_GAP_INVALID_TIME`, a fall-back repeat resolves to the earlier offset. It
derives `ShopNow = { localDate, currentMinute, utcEpochMs }` from
`ports.nowUtcMs()` the same way and hands it to systems, which compute with
`localDate` + `currentMinute` only and use `utcEpochMs` to stamp
lifecycle instants (`confirmedAtUtcMs`, `cancelledAtUtcMs`). No entity stores a zone; no system
converts zones.

## Adapters (`firestore-schedules.adapter.ts`, `console-telemetry.adapter.ts`)

```ts
// condensed: loadSchedule, loadScheduleException and listBarbers have the same shape
export const firestoreSchedulePorts = (
  db: Firestore,
): BarberListPorts & ShopDayReadPorts => ({
  loadBusyDay: async (key) => {
    const path = `${Collections.BarberBusy}/${key}`;
    try {
      const snap = await db.collection(Collections.BarberBusy).doc(key).get();
      return Result.ok(
        snap.exists ? ({ id: snap.id, ...snap.data() } as BarberBusyDay) : null,
      );
    } catch (error) {
      return Result.err(readFailed(path, error));
    }
  },
});
```

`readFailed` / `writeFailed` / `bodyOf` come from `adapters/store-answer.ts`,
the one home of what an adapter answers its port with: the `reason` is the
failure's canonical code (`FailureCodeSystem.codeOf`), never the SDK's message.

The document body is the entity minus `id` — spread, do not map. An adapter
implements exactly one port family over one SDK and holds no business logic.
Validation of foreign input (HTTP bodies, callable payloads) happens once, at
the route/handler edge, with a pure guard from the component's companion.

## Composition root

`apps/functions/src/main.ts` today: build the adapters once per cold start
— the Admin SDK ones on first use, and the console telemetry
(`console-telemetry.adapter.ts`, over `firebase-functions/logger`; Pino and
Sentry are not installed, and their adapters would replace it with the same
bundles (`TelemetryPorts`, `LogContextPorts`)) — assemble the port bundles, call the pipeline factories, wrap
each use-case function in `onCall`/`onDocument*`/`onSchedule` through the
edge (`edge.ts`) and the wire (`wire/*.wire.ts`), and map `Result.err` →
`HttpsError` at that edge only. A callable answers its pipeline's value as
it is: the pipeline's answer type IS `CallableWire[N]['answer']`, and
`wiredCallable` proves it (`AnswerIsTheWire`). An answer that keeps
server-only fields is narrowed by a named `Result.map` (`committedOf`),
never by an encoder that copies fields. If the Hono-on-Cloud-Run
`apps/api` move is confirmed, the same wiring moves into its
`routes/*.router.ts` with typed Hono RPC endpoints — the pipelines do not
change.

## Spec contract (`*.pipeline.spec.ts`)

Pipelines are tested with in-memory port implementations (plain functions
over arrays/maps) and a pinned `nowUtcMs`/`nextId` (`pinnedNowUtcMs`,
`FIXTURE_NOW` from `@core/testing`). Assert the write plan that
reached `commit` (and, once a task port exists, the tasks that reached it);
never assert on Firestore mocks' internals.
