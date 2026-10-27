/**
 * Compile-only proofs over the audit trail's read ports (audit-hardening
 * WS-7, Law 9): `AuditReadPorts` is EXACTLY the intersection of its two
 * focused bundles — every member one of the two, nothing carved back out
 * of a catalogue — the bundles share no member, and every timeline answers
 * the same newest-first page of whole rows. `tsc` failing IS the test;
 * nothing here runs.
 */
import type { AuditEntry } from '@core/entities';
import type { UtcEpochMs } from '@core/primitives';
import type { Disjoint } from '@core/testing';
import type {
  AuditOperationPorts,
  AuditReadPorts,
  AuditTimelinePage,
  AuditTimelinePorts,
} from './audit-read.port';

/** `true` when `A` and `B` are mutually assignable. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const readIsTheIntersection: Same<
  AuditReadPorts,
  AuditTimelinePorts & AuditOperationPorts
> = true;

export const bundlesDisjoint: Disjoint<
  AuditTimelinePorts,
  AuditOperationPorts
> = true;

export const readMembers: Same<
  keyof AuditReadPorts,
  | 'pageAuditByTargetCustomer'
  | 'pageAuditByTargetUser'
  | 'pageAuditByResource'
  | 'pageAuditByActorUser'
  | 'pageAuditByActorAdmin'
  | 'auditRowsForOperation'
> = true;

/** Every timeline answers one page shape: whole rows, a `recordedAtUtcMs` cursor. */
type TimelineAnswer = Awaited<
  ReturnType<AuditTimelinePorts[keyof AuditTimelinePorts]>
>;
export const oneTimelineAnswer: Same<
  Extract<TimelineAnswer, { readonly ok: true }>['value'],
  AuditTimelinePage
> = true;
export const pageRows: Same<AuditTimelinePage['rows'], readonly AuditEntry[]> =
  true;
export const pageCursor: Same<AuditTimelinePage['cursor'], UtcEpochMs | null> =
  true;

declare const ports: AuditReadPorts;
// A bundle is a whole record, never a slice: each half accepts the suite as is.
export const timelines: AuditTimelinePorts = ports;
export const operations: AuditOperationPorts = ports;
// @ts-expect-error — the timelines alone are not the whole read
export const notWhole: AuditReadPorts = timelines;
