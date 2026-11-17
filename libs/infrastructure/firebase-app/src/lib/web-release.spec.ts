import { describe, expect, it } from 'vitest';
import { WEB_RELEASE } from './web-release';

describe('WEB_RELEASE', () => {
  // The deploy's build compiles `CREATIVO_RELEASE` in as a literal (an
  // esbuild define, ADR 2026-11-18 R9); a test run has no define, so the
  // stamp is the `null` every issue carried before it.
  it('is null in a build without the define', () => {
    expect(WEB_RELEASE).toBeNull();
  });
});
