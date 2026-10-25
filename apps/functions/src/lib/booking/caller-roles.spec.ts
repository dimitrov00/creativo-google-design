import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ActorRole, Roles } from '@core/components';
import {
  callerActor,
  callerActorAsClaimed,
  callerIsAdmin,
  callerKnownRoles,
  callerRoles,
  callerUserId,
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
    expect(Roles.ALL.filter((role) => callerIsAdmin(caller([role])))).toEqual([
      'admin',
      'sysadmin',
    ]);
  });

  it('admits an owner who is a barber too: any member of the pair is enough', () => {
    expect(callerIsAdmin(caller(['barber', 'admin']))).toBe(true);
    expect(callerIsAdmin(caller(['barber', 'receptionist']))).toBe(false);
  });

  it('holds the same pair as isAdmin() in firestore.rules', () => {
    expect([...Roles.ADMIN].sort()).toEqual(rulesAdminRoles().sort());
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

describe('callerWorksTheBook', () => {
  it('admits the four roles that work the book — never a content manager or a client', () => {
    expect(
      Roles.ALL.filter((role) => callerWorksTheBook(caller([role]))),
    ).toEqual(['barber', 'receptionist', 'admin', 'sysadmin']);
  });

  it('refuses a claim nobody promised', () => {
    expect(callerWorksTheBook({})).toBe(false);
    expect(callerWorksTheBook(caller('barber'))).toBe(false);
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

  it('String-coerces every entry — a list inside the list reads as its text', () => {
    expect(callerRoles(caller([['admin'], 7]))).toEqual(['admin', '7']);
  });
});

describe('callerKnownRoles', () => {
  it('keeps the known roles, each once, in order — an unknown string grants nothing', () => {
    expect(
      callerKnownRoles(caller(['barber', 'wizard', 'admin', 'barber'])),
    ).toEqual(['barber', 'admin']);
  });

  it('reads the entries AS THEY ARE, as callerIsAdmin and the rules do: a list inside the list is no role', () => {
    expect(callerKnownRoles(caller([['admin']]))).toEqual([]);
    expect(callerKnownRoles(caller('admin'))).toEqual([]);
    expect(callerKnownRoles({})).toEqual([]);
  });
});

describe('callerUserId', () => {
  it('reads the verified uid as the brand — an empty or absent uid is nobody', () => {
    expect(callerUserId(caller([], 'u-1'))).toBe('u-1');
    expect(callerUserId({ auth: { uid: '', token: {} } })).toBeNull();
    expect(callerUserId({ auth: null })).toBeNull();
    expect(callerUserId({})).toBeNull();
  });
});

describe('callerActor', () => {
  it('records the owner as admin and the vendor as staff: access is not attribution', () => {
    expect(callerActor(caller(['barber', 'admin']))).toEqual({
      actorRole: ActorRole.Admin,
      actorAdminUserId: 'dev-staff-ivan',
    });
    expect(callerActor(caller(['sysadmin']))).toEqual({
      actorRole: ActorRole.Staff,
      actorUserId: 'dev-staff-ivan',
      actorRoles: ['sysadmin'],
    });
    expect(callerActor(caller(['client']))).toEqual({
      actorRole: ActorRole.User,
      actorUserId: 'dev-staff-ivan',
    });
  });

  it('names nobody when there is no verified caller', () => {
    expect(callerActor({})).toBeNull();
    expect(callerActor({ auth: { uid: '', token: {} } })).toBeNull();
  });
});

describe('the two readings of the claim’s entries (§9 R6)', () => {
  // They agree on every claim anybody mints and part only on one nobody
  // does: `callerActor` String-coerces (`String(['admin'])` is `'admin'`),
  // `callerActorAsClaimed` hands the entries over as they are.
  it('agree on every minted claim', () => {
    for (const roles of [
      ['barber', 'admin'],
      ['sysadmin'],
      ['receptionist'],
      ['client'],
      [],
    ]) {
      expect(callerActorAsClaimed(caller(roles))).toEqual(
        callerActor(caller(roles)),
      );
    }
  });

  it('part on a list inside the list: coerced, it is the owner; as claimed, a plain user', () => {
    const odd = caller([['admin']]);
    expect(callerActor(odd)?.actorRole).toBe(ActorRole.Admin);
    expect(callerActorAsClaimed(odd)?.actorRole).toBe(ActorRole.User);
  });

  it('name nobody without a verified caller', () => {
    expect(callerActorAsClaimed({})).toBeNull();
  });
});
