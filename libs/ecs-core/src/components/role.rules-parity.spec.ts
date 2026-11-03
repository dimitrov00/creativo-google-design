import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  functionBody,
  helperRoles,
  listRoles,
  ownStatements,
  roleLiterals,
  rulesCode,
} from '@core/testing';
import { Roles } from './roles.data';

/**
 * The role groupings of `roles.data.ts` (`Roles`) and the helpers in `firestore.rules` are
 * "two dialects of one rule", and the rules file cannot import this one. This
 * spec reads the rules text and holds them equal. Copied (not moved) from the
 * legacy accounts `user-role.rules-parity.spec.ts`, which guarded the legacy
 * `user-role.ts` until the accounts lib was deleted in Phase 4b (ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1). It is the seed of the
 * capability-matrix harness (client-details design §12.6.3), which later drives
 * the rules lane from the same role sets.
 *
 * The CALLABLE-ONLY lists have no case here — no rules helper twins them,
 * because the callables are the only door: `Roles.PRIVACY` (the admin alone
 * — the data-subject export and erasure, audit-hardening Phase 3
 * P3-RU-13), and `Roles.ASSIGN` / `Roles.ASSIGNABLE` (the admin alone, and
 * every role but the sysadmin — the `setRoles` roles change, security
 * hardening S-RU-14; `users.roles` takes no client write at all).
 *
 * The reader is `@core/testing`'s `rules-text.ts` — the one every
 * rules-text spec parses the file with (its own cases sit beside it).
 */

/** The nearest ancestor holding `nx.json`, however deep this spec moves. */
function workspaceRoot(from: string): string {
  let dir = from;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks up from this spec's own directory, never external input.
  while (!existsSync(join(dir, 'nx.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no nx.json above ${from}`);
    dir = parent;
  }
  return dir;
}

const RULES = rulesCode(
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the workspace's own rules file, located from this spec.
  readFileSync(join(workspaceRoot(__dirname), 'firestore.rules'), 'utf8'),
);

/**
 * `MONEY_ROLES`' twin. The design names it `frontDesk()` (§3.6.2); until the
 * rules carry a helper, it is the clientele-listing clause, which
 * role.data.ts already names as the same three roles.
 */
function moneyTwin(rules: string): {
  source: string;
  roles: ReadonlySet<string>;
} {
  for (const name of ['frontDesk', 'handlesMoney']) {
    if (functionBody(rules, name) !== undefined) {
      return { source: `${name}()`, roles: helperRoles(rules, name) };
    }
  }
  return {
    source: 'match /users/{uid} allow list',
    roles: listRoles(rules, ownStatements(rules, '/users/{uid}')),
  };
}

const sorted = (roles: Iterable<string>) => [...roles].sort();

// ── the twins ───────────────────────────────────────────────────────────

describe('role.data.ts and firestore.rules agree', () => {
  it('STAFF_ROLES is isStaff()', () => {
    expect(sorted(helperRoles(RULES, 'isStaff'))).toEqual(sorted(Roles.STAFF));
  });

  it('BOOK_ROLES is worksTheBook()', () => {
    expect(sorted(helperRoles(RULES, 'worksTheBook'))).toEqual(
      sorted(Roles.BOOK),
    );
  });

  it('ADMIN_ROLES is isAdmin() (Phase 4a §3.2: the impersonation callables’ caller gate)', () => {
    expect(sorted(helperRoles(RULES, 'isAdmin'))).toEqual(sorted(Roles.ADMIN));
  });

  it('MONEY_ROLES is the front desk', () => {
    const twin = moneyTwin(RULES);
    expect(sorted(twin.roles), twin.source).toEqual(sorted(Roles.MONEY));
  });

  it('SPEND_ROLES is the read grant of clientStats/{id}/restricted (the spend)', () => {
    expect(
      sorted(listRoles(RULES, ownStatements(RULES, '/restricted/{docId}'))),
    ).toEqual(sorted(Roles.SPEND));
  });

  it('every role the rules name is a Role', () => {
    const named = new Set<string>();
    for (const list of RULES.matchAll(
      /(?:hasAnyRole|roles\(\)\s*\.\s*hasAny)\(\s*\[([^\]]*)\]/g,
    )) {
      for (const role of roleLiterals(list[1] ?? '')) named.add(role);
    }
    expect(named.size).toBeGreaterThan(0);
    const strangers = [...named].filter(
      (role) => !(Roles.ALL as readonly string[]).includes(role),
    );
    expect(strangers).toEqual([]);
  });
});
