import { describe, expect, it } from 'vitest';
import {
  blockOf,
  helperRoles,
  listRoles,
  occurrences,
  ownStatements,
  rulesCode,
} from './rules-text';

/*
 * The one `firestore.rules` text reader, on the formatting it must survive
 * — the cases `role.rules-parity.spec.ts` held while the reader was its own
 * (next pass, 2026-11-03), and the block reader the firestore lib's
 * rules-text specs share.
 */

const sorted = (roles: Iterable<string>) => [...roles].sort();

const FIXTURE = rulesCode(`
  function hasAnyRole(candidates) { return roles().hasAny(candidates); }
  function spread() {
    return (hasAnyRole([
      "barber",   // double quotes, a comment inside the list
      'admin',    /* and a block one */
    ]));
  }
  function chained() {
    return spread()
      || roles().hasAny(['receptionist'])
      || hasAnyRole(['sysadmin']);
  }
  function guarded() { return isSignedIn() && hasAnyRole(['admin']); }
  function letBound() { let r = ['admin']; return hasAnyRole(r); }
  function url() { return hasAnyRole(['http://not-a-comment']); }
  match /users/{uid} {
    allow get: if isOwner(uid);
    allow list: if isOwner(uid)
      || hasAnyRole(['receptionist', 'admin']);
    match /inbox/{id} { allow list: if hasAnyRole(['barber']); }
  }
  match /notes/{id} { allow create: if request.resource.data.text != '}'; }
`);

describe('rulesCode — the comment stripper', () => {
  it('drops line and block comments and keeps quoted text whole', () => {
    expect(
      rulesCode(`a // gone\nb /* gone */ c 'x // kept' "/* kept */"`),
    ).toBe(`a \nb   c 'x // kept' "/* kept */"`);
  });

  it('refuses an unterminated string or comment rather than guessing', () => {
    expect(() => rulesCode(`'open`)).toThrow(/unterminated string/);
    expect(() => rulesCode(`/* open`)).toThrow(/unterminated comment/);
  });
});

describe('blockOf and occurrences', () => {
  it('reads a whole match block, nested blocks and a brace inside a string included', () => {
    expect(blockOf(FIXTURE, '/users/{uid}')).toMatch(
      /^match \/users\/\{uid\} \{[\s\S]*match \/inbox\/\{id\}[\s\S]*\}$/,
    );
    expect(blockOf(FIXTURE, '/notes/{id}')).toBe(
      `match /notes/{id} { allow create: if request.resource.data.text != '}'; }`,
    );
    expect(() => blockOf(FIXTURE, '/absent/{id}')).toThrow(/no match/);
  });

  it('counts a needle', () => {
    expect(occurrences(FIXTURE, 'hasAnyRole([')).toBe(6);
    expect(occurrences(FIXTURE, 'absent')).toBe(0);
  });
});

describe('the role reader', () => {
  it('reads a multi-line list with either quote, comments and a trailing comma', () => {
    expect(sorted(helperRoles(FIXTURE, 'spread'))).toEqual(['admin', 'barber']);
  });

  it('follows helper calls and the `roles().hasAny` form through `||`', () => {
    expect(sorted(helperRoles(FIXTURE, 'chained'))).toEqual([
      'admin',
      'barber',
      'receptionist',
      'sysadmin',
    ]);
  });

  it('keeps a `//` inside a string', () => {
    expect(sorted(helperRoles(FIXTURE, 'url'))).toEqual([
      'http://not-a-comment',
    ]);
  });

  it('refuses a helper that is more than a role check', () => {
    expect(() => helperRoles(FIXTURE, 'guarded')).toThrow(
      /not a plain role check/,
    );
    expect(() => helperRoles(FIXTURE, 'letBound')).toThrow(/single return/);
    expect(() => helperRoles(FIXTURE, 'absent')).toThrow(/define no absent/);
  });

  it("reads a block's own list grant, not a nested block's", () => {
    const own = ownStatements(FIXTURE, '/users/{uid}');
    expect(sorted(listRoles(FIXTURE, own))).toEqual(['admin', 'receptionist']);
  });
});
