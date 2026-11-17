import { RELEASE_ENV, serverRelease } from './release';

describe('serverRelease', () => {
  it('reads the stamp the env writer wrote', () => {
    expect(RELEASE_ENV).toBe('CREATIVO_RELEASE');
    expect(serverRelease({ CREATIVO_RELEASE: '0.4.1' })).toBe('0.4.1');
    expect(serverRelease({ CREATIVO_RELEASE: '0.4.1+abc1234' })).toBe(
      '0.4.1+abc1234',
    );
  });

  it('is null without one — the emulator, a deploy that carried none', () => {
    expect(serverRelease({})).toBeNull();
    expect(serverRelease({ CREATIVO_RELEASE: '' })).toBeNull();
  });

  it('refuses any other shape rather than stamp it on every line', () => {
    expect(serverRelease({ CREATIVO_RELEASE: '0.4.1 beta' })).toBeNull();
    expect(serverRelease({ CREATIVO_RELEASE: '"0.4.1"' })).toBeNull();
    expect(serverRelease({ CREATIVO_RELEASE: 'x'.repeat(65) })).toBeNull();
    expect(serverRelease({ CREATIVO_RELEASE: 'x'.repeat(64) })).toBe(
      'x'.repeat(64),
    );
  });
});
