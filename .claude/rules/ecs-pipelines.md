---
paths:
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

## Ports are function types (`storage.port.ts`, `telemetry.port.ts`)

```ts
import type {
  AppointmentEntity,
  AppointmentId,
} from '../entities/appointment.entity';

export type LoadAppointment = (
  id: AppointmentId,
) => Promise<AppointmentEntity | null>;
export type LoadBusyForDay = (
  barberId: BarberId,
  dayStartMs: number,
) => Promise<readonly TimeInterval[]>;

/** The transactional sandwich: reads → pure decide → writes, atomically. */
export type CommitBooking = <D>(
  read: (tx: ReadTx) => Promise<BookingSnapshot>,
  decide: (
    snapshot: BookingSnapshot,
  ) => Result<D & { writes: readonly WriteOp[] }, BookingError>,
) => Promise<Result<D, BookingError>>;

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
A port bundle is a plain object type: `export type BookingPorts = { load: …;
commit: …; log: Log; nowMs: () => number; nextId: () => string }`.

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
          nowMs: ports.nowMs(),
          nextId: ports.nextId,
        }), // 2
    ); // 3
    if (!result.ok) {
      ports.log('warn', 'booking.rejected', {
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

- No business math inside the pipeline; if you are comparing intervals or
  summing money here, move it to a system.
- No SDK import (`firebase-admin`, `pino`, `@sentry/*`) inside a pipeline.
- `nowMs`/`nextId` are ports so specs can pin them.

## The ingestion boundary owns time (Law 7)

A pipeline that accepts a wall-clock time (a booking, a block, a move) loads
the location, reads its `timeZone`, and calls `ZonedTimeSystem` ONCE to
compute `utcEpochMs` — a spring-forward gap time returns the error
`DST_GAP_INVALID_TIME`, a fall-back repeat resolves to the earlier offset. It
derives `ShopNow = { localDate, currentMinute, utcEpochMs }` from
`ports.nowUtcMs()` the same way and hands it to systems, which compute with
`localDate` + `currentMinute` only and use `utcEpochMs` solely to stamp
lifecycle instants (`confirmedAtUtcMs`, `cancelledAtUtcMs`). No entity stores a zone; no system
converts zones.

## Adapters (`firestore.adapter.ts`, `pino.adapter.ts`, `sentry.adapter.ts`)

```ts
export const firestoreLoadAppointment =
  (db: Firestore): LoadAppointment =>
  async (id) => {
    const snap = await db.collection('appointments').doc(id).get();
    return snap.exists
      ? { id, ...(snap.data() as Omit<AppointmentEntity, 'id'>) }
      : null;
  };
```

The document body is the entity minus `id` — spread, do not map. An adapter
implements exactly one port family over one SDK and holds no business logic.
Validation of foreign input (HTTP bodies, callable payloads) happens once, at
the route/handler edge, with a pure guard from the component's companion.

## Composition root

`apps/functions/src/main.ts` today: build the adapters from the Admin SDK,
Pino and Sentry once per cold start, assemble the port bundles, call the
pipeline factories, wrap each use-case function in `onCall`/`onDocument*`
and map `Result.err` → `HttpsError` at that edge only. If the Hono-on-Cloud-Run
`apps/api` move is confirmed, the same wiring moves into its
`routes/*.router.ts` with typed Hono RPC endpoints — the pipelines do not
change.

## Spec contract (`*.pipeline.spec.ts`)

Pipelines are tested with in-memory port implementations (plain functions
over arrays/maps) and a pinned `nowMs`/`nextId`. Assert the write plan that
reached `commit` and the tasks that reached `enqueue`; never assert on
Firestore mocks' internals.
