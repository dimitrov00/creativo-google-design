import type { Firestore } from 'firebase-admin/firestore';
import type { Hash, NextId, NowMs, TxPorts } from '@creativo/ecs-core';
import { firestoreCommitPlan } from './firestore-tx.adapter';

/**
 * The Firestore port assembler (blueprint §4.3): `main.ts` calls
 * `firestorePorts(db, { nowMs, nextId, hash })` ONCE per cold start, on the
 * first request that needs Firestore, and hands the bundles to the pipeline
 * factories. The only place a Firestore-backed port is constructed.
 *
 * Phase 3a holds the body-free bundle alone — the single `CommitPlan` over
 * the transaction adapter, plus the three impure primitives every pipeline
 * passes its systems. No collection-backed port exists before its
 * collection's flip (3b), because each one reads a document body that flip
 * reshapes.
 *
 * Extension point, by type: a flip adds its collections' server bundle as
 * one more member of the {@link FirestorePorts} intersection and spreads its
 * adapter factory into the object `firestorePorts` returns
 * (`...firestoreSchedulingPorts(db)`); until both are there the root does
 * not compile, so a bundle can never be declared and left unbuilt.
 */

/** The impure primitives the root draws once per cold start — `TxPorts` minus `commit`. */
export type Primitives = {
  readonly nowMs: NowMs;
  readonly nextId: NextId;
  readonly hash: Hash;
};

/** Every Firestore-backed bundle, intersected — one member per flipped collection closure. */
export type FirestorePorts = TxPorts;

export const firestorePorts = (
  db: Firestore,
  primitives: Primitives,
): FirestorePorts => ({
  commit: firestoreCommitPlan(db),
  nowMs: primitives.nowMs,
  nextId: primitives.nextId,
  hash: primitives.hash,
});
