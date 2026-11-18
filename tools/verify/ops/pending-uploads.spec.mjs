// node --test tools/verify/ops/pending-uploads.spec.mjs
//
// The pending-uploads folder (docs/architecture/decisions/
// 2026-11-15-one-photo-per-barber.md, F5): the browser parks a file under
// `pending/{uid}/`, a callable takes it, and the bucket's lifecycle rule
// (tools/ops/storage-lifecycle.json) deletes whatever was never taken. Three
// homes name the folder — the lifecycle rule, the storage rule and the one
// path builder, `BarberPhotoSystem.stagedPathOf` — so a rename that misses one
// would leave leftovers that nothing deletes, or a rule that guards nothing.
// This holds them to one prefix, and the lifecycle rule to that prefix alone,
// so it can never reach a file the shop keeps.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** The folder, with its trailing slash: a bare `pending` would match `pendingX/` too. */
const PREFIX = 'pending/';

const LIFECYCLE = JSON.parse(read('tools/ops/storage-lifecycle.json'));
const RULES = read('storage.rules');
const SYSTEM = read('libs/ecs-core/src/systems/barber-photo.system.ts');

/** The `match` block for the pending folder, from its line to its closing brace. */
const pendingBlock = () => {
  const start = RULES.indexOf('match /pending/{userId}/{fileName} {');
  assert.notEqual(
    start,
    -1,
    'storage.rules has no `match /pending/{userId}/{fileName}`',
  );
  const end = RULES.indexOf('\n    }', start);
  return RULES.slice(start, end);
};

describe('pending uploads — one folder, one cleanup', () => {
  it('the lifecycle rule is one Delete of what is a day old under pending/, and nothing else', () => {
    assert.deepEqual(LIFECYCLE, {
      rule: [
        {
          action: { type: 'Delete' },
          condition: { age: 1, matchesPrefix: [PREFIX] },
        },
      ],
    });
  });

  it('storage.rules guards that folder: its own uid writes, nobody reads', () => {
    const block = pendingBlock();
    assert.match(block, /allow read: if false;/);
    assert.match(block, /allow create, update: if isOwner\(userId\)/);
    assert.match(block, /allow delete: if isOwner\(userId\);/);
  });

  it('the one path builder writes under that folder', () => {
    assert.match(
      SYSTEM,
      /stagedPathOf\(userId: UserId, stagedName: string\): string \{\s*return `pending\/\$\{userId\}\/\$\{stagedName\}`;/,
    );
  });

  it('the lifecycle prefix is exactly one storage rule folder: the pending one', () => {
    const folders = [...RULES.matchAll(/match \/([^/{}\s]+)\//g)]
      .map((match) => `${match[1]}/`)
      .filter((folder) => folder !== 'b/');
    assert.deepEqual(
      folders.filter((folder) => folder.startsWith(PREFIX)),
      [PREFIX],
    );
  });
});
