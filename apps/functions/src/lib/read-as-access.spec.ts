import { describe, expect, it } from 'vitest';
import { Callables } from '@core/ports';
import { CALLABLE_READ_AS_ACCESS, ReadAsAccess } from './read-as-access';

describe('CALLABLE_READ_AS_ACCESS — what a support read-as may call (OR-24)', () => {
  it('is total over the registry: one row per callable, no other key', () => {
    expect(Object.keys(CALLABLE_READ_AS_ACCESS).sort()).toEqual(
      Object.values(Callables).sort(),
    );
  });

  /**
   * Open: the two reads, the session's own end and the issue sink. Closed:
   * every write — and the owner's privacy acts, which are reads of a kind
   * but stay behind the walls (owner ruling 2026-11-24).
   */
  it('opens exactly the reads, the session’s own end and the issue sink', () => {
    const open = Object.entries(CALLABLE_READ_AS_ACCESS)
      .filter(([, access]) => access === ReadAsAccess.Open)
      .map(([name]) => name)
      .sort();
    expect(open).toEqual(
      [
        Callables.EndImpersonation,
        Callables.ListTeam,
        Callables.ReportClientIssues,
        Callables.StaffAnalytics,
      ].sort(),
    );
    expect(CALLABLE_READ_AS_ACCESS[Callables.ExportClientData]).toBe(
      ReadAsAccess.Closed,
    );
    expect(CALLABLE_READ_AS_ACCESS[Callables.PreviewClientErasure]).toBe(
      ReadAsAccess.Closed,
    );
  });
});
