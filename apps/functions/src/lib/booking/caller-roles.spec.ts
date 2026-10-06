import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { USER_ROLES } from '@creativo/domain/accounts';
import {
  ADMIN_ROLES,
  callerActor,
  callerIsAdmin,
  callerRoles,
  callerWorksTheBook,
} from './caller-roles';

/**
 * The gates every callable reads the caller through. All of them judge the
 * VERIFIED token's `roles` claim and nothing else, so what is pinned here is
 * the claim's reading: the roles that pass, and every shape of a claim that
 * nobody promised.
 */

/** A callable's request, as far as a gate looks at it. */
function caller(roles: unknown, uid = 'dev-staff-ivan') {
  return { auth: { uid, token: { roles } } };
}

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

/**
 * The roles `isAdmin()` admits in `firestore.rules`, read off the rules'
 * text. The helper is one `hasAnyRole([...])`; anything else is refused by
 * name, never guessed at.
 */
function rulesAdminRoles(): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the workspace's own rules file, located from this spec.
  const rules = readFileSync(
    join(workspaceRoot(__dirname), 'firestore.rules'),
    'utf8',
  );
  const helper =
    /function isAdmin\(\)\s*\{\s*return hasAnyRole\(\[([^\]]*)\]\);\s*\}/.exec(
      rules,
    );
  if (!helper) throw new Error('isAdmin() is not one hasAnyRole([...])');
  return [...(helper[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map(
    (role) => role[1] ?? '',
  );
}

describe('callerIsAdmin', () => {
  it.each([['admin'], ['sysadmin']])('admits %s', (role) => {
    expect(callerIsAdmin(caller([role]))).toBe(true);
  });

  it.each([['client'], ['barber'], ['receptionist'], ['content_manager']])(
    'refuses %s',
    (role) => {
      expect(callerIsAdmin(caller([role]))).toBe(false);
    },
  );

  it('admits the pair and nobody else, role by role', () => {
    expect(USER_ROLES.filter((role) => callerIsAdmin(caller([role])))).toEqual([
      'admin',
      'sysadmin',
    ]);
  });

  it('admits an owner who is a barber too: any member of the pair is enough', () => {
    expect(callerIsAdmin(caller(['barber', 'admin']))).toBe(true);
    expect(callerIsAdmin(caller(['barber', 'receptionist']))).toBe(false);
  });

  it('holds the same pair as isAdmin() in firestore.rules', () => {
    expect([...ADMIN_ROLES].sort()).toEqual(rulesAdminRoles().sort());
  });

  it('refuses a token with no claim', () => {
    expect(callerIsAdmin({ auth: { token: {} } })).toBe(false);
    expect(callerIsAdmin({ auth: {} })).toBe(false);
    expect(callerIsAdmin({})).toBe(false);
  });

  it.each([
    ['a string', 'admin'],
    ['a map', { admin: true }],
    ['a flag', true],
    ['null', null],
    ['a number', 1],
  ])('refuses a claim that is not an array: %s', (_name, claim) => {
    expect(callerIsAdmin(caller(claim))).toBe(false);
  });

  it('refuses a near miss: the role is matched whole and as spelled', () => {
    expect(callerIsAdmin(caller(['Admin']))).toBe(false);
    expect(callerIsAdmin(caller(['admin ']))).toBe(false);
    expect(callerIsAdmin(caller(['administrator']))).toBe(false);
    expect(callerIsAdmin(caller([['admin']]))).toBe(false);
    expect(callerIsAdmin(caller([null, undefined, 7]))).toBe(false);
  });

  it('is a narrower gate than the book: a barber works the book and manages nothing', () => {
    const barber = caller(['barber']);
    expect(callerWorksTheBook(barber)).toBe(true);
    expect(callerIsAdmin(barber)).toBe(false);
  });
});

describe('callerRoles', () => {
  it('reads the claim as strings, in the order given', () => {
    expect(callerRoles(caller(['barber', 'admin']))).toEqual([
      'barber',
      'admin',
    ]);
  });

  it('yields no roles for a claim nobody promised', () => {
    expect(callerRoles({})).toEqual([]);
    expect(callerRoles({ auth: { token: {} } })).toEqual([]);
    expect(callerRoles(caller('admin'))).toEqual([]);
  });
});

describe('callerActor', () => {
  it('records the owner as admin and the vendor as staff: access is not attribution', () => {
    expect(callerActor(caller(['barber', 'admin']))?.kind).toBe('admin');
    const vendor = callerActor(caller(['sysadmin']));
    expect(vendor?.kind).toBe('staff');
    expect(vendor?.kind === 'staff' ? vendor.roles : null).toEqual([
      'sysadmin',
    ]);
  });

  it('names nobody when there is no verified caller', () => {
    expect(callerActor({})).toBeNull();
    expect(callerActor({ auth: { uid: '', token: {} } })).toBeNull();
  });
});
