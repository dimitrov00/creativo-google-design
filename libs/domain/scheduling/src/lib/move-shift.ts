import { MoveSystem } from '@creativo/ecs-core';

/*
 * THIN SHIM (ECS migration Phase 2). THE SHIFT — where a client move puts a
 * seat it CARRIES — is `MoveSystem.carriedOffsetMinutes` /
 * `MoveSystem.carriedStartMs`: one implementation for the server, the
 * availability engine and the review card. A carried seat keeps its distance
 * (WHOLE minutes, rounded once) from the visit's move anchor and lands that
 * far from wherever the cart's earliest seat lands now; the arithmetic is on
 * instants, so a DST boundary changes nothing.
 */

/**
 * Minutes from the move anchor to a carried seat's start — what a move
 * keeps. Negative when the carried seat starts first.
 */
export function carriedOffsetMinutes(
  seatStartMs: number,
  anchorMs: number,
): number {
  return MoveSystem.carriedOffsetMinutes(seatStartMs, anchorMs);
}

/**
 * Where a carried seat starts once the cart's earliest seat starts at
 * `cartEarliestMs` — its kept offset from there.
 */
export function carriedStartMs(
  cartEarliestMs: number,
  offsetMinutes: number,
): number {
  return MoveSystem.carriedStartMs(cartEarliestMs, offsetMinutes);
}
