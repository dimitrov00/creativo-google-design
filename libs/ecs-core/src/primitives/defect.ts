/**
 * The ONE sanctioned `throw` in the core (Law 7.5): an unrecoverable
 * programmer defect — an exhausted `switch`, a broken structural invariant —
 * never an expected outcome. Expected failures are `Result` values whose
 * error is a flat `{ errorCode, … }` struct; a defect never crosses a system
 * boundary as control flow.
 *
 * This file carries no ECS suffix on purpose, so the `ThrowStatement` guard
 * of the `*.system.ts` / `*.data.ts` / `*.entity.ts` / `*.primitive.ts`
 * blocks (L5) does not reach it.
 */
export function defect(message: string): never {
  throw new Error(`defect: ${message}`);
}
