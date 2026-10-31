// node --test tools/verify/p0/seed-run.spec.mjs
//
// verify:p0 (a) seeds twice at ONE instant (audit-hardening Phase 3,
// P3-DEP-2). No case reads the wall clock: every "now" is pinned.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadSeedDomain } from '../../seed/load-domain.mjs';
import { SEED_NOW, proofInstantOf, seedRunEnv } from './seed-run.mjs';

const NOW = Date.parse('2026-09-25T15:00:00+03:00');
/** 2026-10-27 23:40 in Sofia (+02:00) — the late-shop-time proof's instant. */
const LATE = Date.parse('2026-10-27T23:40:00+02:00');

/** A stand-in for the seed's reader that records how it was asked. */
function recordingReader(answer) {
  const asked = [];
  const reader = (question) => {
    asked.push(question);
    return answer(question);
  };
  return { reader, asked };
}

describe('seedRunEnv — the env each seed run of the proof gets', () => {
  it('sets SEED_NOW to the one instant, as digits, and keeps the rest', () => {
    const base = Object.freeze({
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      PATH: '/usr/bin',
    });
    assert.deepEqual(seedRunEnv(base, LATE), {
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      PATH: '/usr/bin',
      SEED_NOW: '1793137200000',
    });
    // The caller's env is never written.
    assert.equal(base.SEED_NOW, undefined);
  });

  it('replaces a caller’s SEED_NOW text with the resolved instant', () => {
    assert.deepEqual(seedRunEnv({ SEED_NOW: '2026-10-27T23:40' }, LATE), {
      SEED_NOW: String(LATE),
    });
  });

  it('gives both runs the same env for one instant', () => {
    const base = { HOME: '/root' };
    assert.deepEqual(seedRunEnv(base, NOW), seedRunEnv(base, NOW));
  });
});

describe('proofInstantOf — the one instant of the proof', () => {
  it('asks the seed’s reader with no argv, the caller’s env and the captured clock', () => {
    const env = { SEED_NOW: '2026-10-27T23:40', OTHER: 'x' };
    const { reader, asked } = recordingReader(() => LATE);
    assert.equal(proofInstantOf(env, NOW, reader), LATE);
    assert.deepEqual(asked, [{ argv: [], env, realNowMs: NOW }]);
  });

  it('lets a malformed SEED_NOW throw, before any run', () => {
    const { reader } = recordingReader(({ env }) => {
      throw new Error(`seed: SEED_NOW '${env.SEED_NOW}' is no instant (X)`);
    });
    assert.throws(() => proofInstantOf({ SEED_NOW: 'soon' }, NOW, reader), {
      message: "seed: SEED_NOW 'soon' is no instant (X)",
    });
  });

  // The seed's own reader, from the bundle verify-p0 loads.
  it('with the seed’s reader: prefers a valid SEED_NOW, else the clock, and throws on a malformed one', async () => {
    const { book } = await loadSeedDomain();
    assert.equal(book.SEED_NOW_ENV, SEED_NOW);
    assert.equal(proofInstantOf({}, NOW, book.seedNowOf), NOW);
    assert.equal(
      proofInstantOf({ SEED_NOW: '2026-10-27T23:40' }, NOW, book.seedNowOf),
      LATE,
    );
    assert.equal(
      proofInstantOf({ SEED_NOW: String(LATE) }, NOW, book.seedNowOf),
      LATE,
    );
    for (const text of ['', 'soon', '-1', '1.5', '2026-03-29T03:30']) {
      assert.throws(
        () => proofInstantOf({ SEED_NOW: text }, NOW, book.seedNowOf),
        (error) =>
          error.message.startsWith(`seed: SEED_NOW '${text}' is no instant (`),
      );
    }
    // The resolved instant round-trips through the env both runs get.
    const env = seedRunEnv({}, LATE);
    assert.equal(proofInstantOf(env, NOW, book.seedNowOf), LATE);
  });
});
