import { describe, expect, it } from 'vitest';
import { defect } from './defect';

describe('defect — the one sanctioned throw (Law 7.5)', () => {
  it('throws a programmer-defect Error', () => {
    expect(() => defect('exhausted switch')).toThrow(
      'defect: exhausted switch',
    );
  });
});
