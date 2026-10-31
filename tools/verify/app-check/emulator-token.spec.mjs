// node --test tools/verify/app-check/emulator-token.spec.mjs
//
// The journeys' App Check tokens (security hardening S-L-4), pinned to the
// decoder the Functions emulator really runs: firebase-functions'
// `unsafeDecodeAppCheckToken` (`lib/common/providers/https.js`), loaded off
// the installed package — never a copy of its JWT shape. And no source under
// tools/verify holds a token as a literal (gitleaks' JWT rule).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  APP_CHECK_HEADER,
  JOURNEY_APP_ID,
  emulatorAppCheckToken,
  invalidAppCheckToken,
} from './emulator-token.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY = join(HERE, '..');

/**
 * firebase-functions' own decoder. The package exports only its public
 * entries, so the internal module is reached beside the `https` entry
 * (`lib/v2/providers/https.js` → `lib/common/providers/https.js`).
 */
const { unsafeDecodeAppCheckToken } = createRequire(
  createRequire(import.meta.url).resolve('firebase-functions/https'),
)('../../common/providers/https.js');

/** One base64url segment, decoded and parsed. */
const parsed = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());

/** Every `.mjs` under `dir`, as `{ path, text }`. */
function scriptsUnder(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...scriptsUnder(full));
    else if (name.endsWith('.mjs')) {
      files.push({ path: full, text: readFileSync(full, 'utf8') });
    }
  }
  return files;
}

describe('the journeys’ App Check tokens', () => {
  it('builds the emulator token unsigned and JWT-shaped, `sub` the app id, and the emulator decodes its app from it', () => {
    const token = emulatorAppCheckToken(JOURNEY_APP_ID);
    const parts = token.split('.');
    assert.equal(parts.length, 3);
    assert.deepEqual(parsed(parts[0]), { alg: 'none' });
    assert.deepEqual(parsed(parts[1]), { sub: JOURNEY_APP_ID });
    assert.equal(parts[2], '', 'no signature');
    for (const part of parts.slice(0, 2)) {
      assert.match(part, /^[\w-]+$/, 'base64url');
    }
    const decoded = unsafeDecodeAppCheckToken(token);
    assert.equal(decoded.sub, JOURNEY_APP_ID);
    assert.equal(decoded.app_id, JOURNEY_APP_ID);
    assert.equal(
      unsafeDecodeAppCheckToken(emulatorAppCheckToken('1:2:web:3')).app_id,
      '1:2:web:3',
    );
  });

  it('builds the INVALID token JWT-shaped with a `null` payload — the emulator’s decoder throws on it', () => {
    const token = invalidAppCheckToken();
    const parts = token.split('.');
    assert.equal(parts.length, 3);
    assert.equal(Buffer.from(parts[0], 'base64url').toString(), 'null');
    assert.equal(Buffer.from(parts[1], 'base64url').toString(), 'null');
    assert.equal(parts[2], '');
    // A token the JWT shape refuses decodes to `{}` (VALID); this one passes
    // the shape and throws reading `.sub` of `null` — the platform's INVALID.
    assert.deepEqual(unsafeDecodeAppCheckToken('not-a-token'), {
      app_id: undefined,
    });
    assert.throws(() => unsafeDecodeAppCheckToken(token), TypeError);
  });

  it('is deterministic — the same input, the same token', () => {
    assert.equal(
      emulatorAppCheckToken(JOURNEY_APP_ID),
      emulatorAppCheckToken(JOURNEY_APP_ID),
    );
    assert.equal(invalidAppCheckToken(), invalidAppCheckToken());
  });

  it('names the header the platform reads', () => {
    assert.equal(APP_CHECK_HEADER, 'X-Firebase-AppCheck');
  });

  it('leaves no token literal in any source under tools/verify', () => {
    const emulator = emulatorAppCheckToken(JOURNEY_APP_ID);
    const [header, payload] = emulator.split('.');
    const invalid = invalidAppCheckToken();
    // The base64url opening of every JSON object segment (`{"…`), computed
    // here so that this file holds no literal of it either.
    const objectOpening = Buffer.from('{"a').toString('base64url').slice(0, 3);
    const scripts = scriptsUnder(VERIFY);
    assert.ok(
      scripts.some(({ path }) => path.endsWith('emulator-token.mjs')),
      'the helper itself is scanned',
    );
    for (const { path, text } of scripts) {
      for (const needle of [header, payload, invalid, objectOpening]) {
        assert.equal(text.includes(needle), false, `${path} holds ${needle}`);
      }
    }
  });
});
