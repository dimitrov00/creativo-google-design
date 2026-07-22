import { describe, expect, it } from 'vitest';
import { NEW_SESSION, RETURNING_SESSION, SessionKind } from './session-kind';

describe('SessionKind', () => {
  it('discriminates on kind', () => {
    expect(NEW_SESSION.kind).toBe('new');
    expect(RETURNING_SESSION.kind).toBe('returning');
  });

  it('narrows exhaustively in a switch', () => {
    function describeSession(session: SessionKind): string {
      switch (session.kind) {
        case 'new':
          return 'new';
        case 'returning':
          return 'returning';
      }
    }
    expect(describeSession(NEW_SESSION)).toBe('new');
    expect(describeSession(RETURNING_SESSION)).toBe('returning');
  });
});
