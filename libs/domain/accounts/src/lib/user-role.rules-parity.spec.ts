import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOOK_ROLES, MONEY_ROLES, STAFF_ROLES, USER_ROLES } from './user-role';

/**
 * The role groupings here and the helpers in `firestore.rules` are "two
 * dialects of one rule" (user-role.ts), and the rules file cannot import
 * this one. This spec reads the rules text and holds them equal. It is the
 * seed of the capability-matrix harness (client-details design §12.6.3),
 * which later drives the rules lane from the same role sets.
 *
 * The reader is deliberately small: it understands a helper whose body is a
 * single `return` of role checks joined by `||`, which is how every
 * role-group helper is written. Anything else (an `&&`, a `let`, a
 * non-role test) is refused by name rather than guessed at.
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

const RULES = stripComments(
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the workspace's own rules file, located from this spec.
  readFileSync(join(workspaceRoot(__dirname), 'firestore.rules'), 'utf8'),
);

// ── the rules reader ────────────────────────────────────────────────────

/** Index of the quote closing the string literal that opens at `start`. */
function closingQuote(src: string, start: number): number {
  const quote = src.charAt(start);
  for (let i = start + 1; i < src.length; i++) {
    if (src.charAt(i) === '\\') i++;
    else if (src.charAt(i) === quote) return i;
  }
  throw new Error(`unterminated string at ${start}`);
}

/** Drops `//` and block comments, leaving string literals intact. */
function stripComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length;) {
    const pair = src.slice(i, i + 2);
    const ch = src.charAt(i);
    if (ch === "'" || ch === '"') {
      const end = closingQuote(src, i);
      out += src.slice(i, end + 1);
      i = end + 1;
    } else if (pair === '//') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end;
    } else if (pair === '/*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) throw new Error(`unterminated comment at ${i}`);
      out += ' ';
      i = end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Index of the bracket closing the one that opens at `open`. */
function closingBracket(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src.charAt(i);
    if (ch === "'" || ch === '"') i = closingQuote(src, i);
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch) && --depth === 0) return i;
  }
  throw new Error(`unbalanced bracket at ${open}`);
}

function functionBody(rules: string, name: string): string | undefined {
  const heads = [
    ...rules.matchAll(/\bfunction\s+(\w+)\s*\(\s*\)\s*\{/g),
  ].filter((head) => head[1] === name);
  if (heads.length > 1) {
    throw new Error(`${name}() is defined ${heads.length} times`);
  }
  const head = heads[0];
  if (!head) return undefined;
  const open = head.index + head[0].length - 1;
  return rules.slice(open + 1, closingBracket(rules, open));
}

/** Splits on the `||` outside every bracket and string. */
function disjuncts(expression: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < expression.length; i++) {
    const ch = expression.charAt(i);
    if (ch === "'" || ch === '"') i = closingQuote(expression, i);
    else if ('([{'.includes(ch)) i = closingBracket(expression, i);
    else if (expression.startsWith('||', i)) {
      parts.push(expression.slice(start, i));
      start = i + 2;
      i++;
    }
  }
  parts.push(expression.slice(start));
  return parts.map(unwrap);
}

function unwrap(term: string): string {
  let t = term.trim();
  while (t.startsWith('(') && closingBracket(t, 0) === t.length - 1) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

function roleLiterals(list: string): string[] {
  return list
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .map((item) => {
      const literal = /^(['"])([^'"]*)\1$/.exec(item);
      if (!literal) throw new Error(`not a role literal: ${item}`);
      return literal[2] ?? '';
    });
}

const ROLE_CHECK = /^(?:hasAnyRole|roles\(\)\s*\.\s*hasAny)\s*\(/;
const HELPER_CALL = /^(\w+)\s*\(\s*\)$/;

/** Roles one term grants outright, or `undefined` when it is no role check. */
function termRoles(
  rules: string,
  term: string,
  trail: readonly string[],
): Set<string> | undefined {
  const check = ROLE_CHECK.exec(term);
  // The call must span the whole term: `hasAnyRole([…]) && x` is no role check.
  if (check && closingBracket(term, check[0].length - 1) === term.length - 1) {
    const list = /^\[([\s\S]*)\]$/.exec(term.slice(check[0].length, -1).trim());
    return list ? new Set(roleLiterals(list[1] ?? '')) : undefined;
  }
  const call = HELPER_CALL.exec(term);
  if (call) return helperRoles(rules, call[1] ?? '', trail);
  return undefined;
}

/** The roles a role-group helper admits, following helpers it calls. */
function helperRoles(
  rules: string,
  name: string,
  trail: readonly string[] = [],
): Set<string> {
  if (trail.includes(name)) {
    throw new Error(`${[...trail, name].join(' → ')} is a cycle`);
  }
  const body = functionBody(rules, name);
  if (body === undefined) throw new Error(`the rules define no ${name}()`);
  const returned = /^\s*return\s+([\s\S]+?);?\s*$/.exec(body);
  if (!returned) {
    throw new Error(`${name}() is not a single return statement`);
  }
  const roles = new Set<string>();
  for (const term of disjuncts(returned[1] ?? '')) {
    const granted = termRoles(rules, term, [...trail, name]);
    if (!granted)
      throw new Error(`${name}() is not a plain role check: ${term}`);
    for (const role of granted) roles.add(role);
  }
  return roles;
}

/**
 * `match` heads. A path holds no whitespace, so it runs to the last `{`
 * before the block: its `{wildcard}` segments are braces too.
 */
const MATCH_HEAD = /\bmatch\s+(\/\S*)\s*\{/g;

/** `/users/{uid}` and `/users/{userId}` are the same path. */
const pathShape = (path: string) => path.replace(/\{[^}]*\}/g, '{}');

/** A `match` block's own statements, its nested `match` blocks cut out. */
function ownStatements(rules: string, path: string): string {
  const heads = [...rules.matchAll(MATCH_HEAD)].filter(
    (head) => pathShape(head[1] ?? '') === pathShape(path),
  );
  const head = heads[0];
  if (!head || heads.length > 1) {
    throw new Error(`the rules match ${path} ${heads.length} times`);
  }
  const open = head.index + head[0].length - 1;
  const block = rules.slice(open + 1, closingBracket(rules, open));
  let own = '';
  let from = 0;
  for (const nested of block.matchAll(MATCH_HEAD)) {
    if (nested.index < from) continue;
    own += block.slice(from, nested.index);
    from = closingBracket(block, nested.index + nested[0].length - 1) + 1;
  }
  return own + block.slice(from);
}

/** Roles a block's `allow` statements grant `list` outright (`read` included). */
function listRoles(rules: string, statements: string): Set<string> {
  const roles = new Set<string>();
  for (const allow of statements.matchAll(
    /\ballow\s+([\w\s,]+?)\s*:\s*if\s+([^;]+);/g,
  )) {
    const methods = (allow[1] ?? '').split(',').map((m) => m.trim());
    if (!methods.includes('list') && !methods.includes('read')) continue;
    // Terms that are not role checks (`isOwner(uid)`) grant no role.
    for (const term of disjuncts(allow[2] ?? '')) {
      for (const role of termRoles(rules, term, []) ?? []) roles.add(role);
    }
  }
  return roles;
}

/**
 * `MONEY_ROLES`' twin. The design names it `frontDesk()` (§3.6.2); until the
 * rules carry a helper, it is the clientele-listing clause, which user-role.ts
 * already names as the same three roles.
 */
function moneyTwin(rules: string): { source: string; roles: Set<string> } {
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

// ── the reader, on formatting it must survive ───────────────────────────

describe('the rules reader', () => {
  const fixture = stripComments(`
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
  `);

  it('reads a multi-line list with either quote, comments and a trailing comma', () => {
    expect(sorted(helperRoles(fixture, 'spread'))).toEqual(['admin', 'barber']);
  });

  it('follows helper calls and the `roles().hasAny` form through `||`', () => {
    expect(sorted(helperRoles(fixture, 'chained'))).toEqual([
      'admin',
      'barber',
      'receptionist',
      'sysadmin',
    ]);
  });

  it('keeps a `//` inside a string', () => {
    expect(sorted(helperRoles(fixture, 'url'))).toEqual([
      'http://not-a-comment',
    ]);
  });

  it('refuses a helper that is more than a role check', () => {
    expect(() => helperRoles(fixture, 'guarded')).toThrow(
      /not a plain role check/,
    );
    expect(() => helperRoles(fixture, 'letBound')).toThrow(/single return/);
    expect(() => helperRoles(fixture, 'absent')).toThrow(/define no absent/);
  });

  it("reads a block's own list grant, not a nested block's", () => {
    const own = ownStatements(fixture, '/users/{uid}');
    expect(sorted(listRoles(fixture, own))).toEqual(['admin', 'receptionist']);
  });
});

// ── the twins ───────────────────────────────────────────────────────────

describe('user-role.ts and firestore.rules agree', () => {
  it('STAFF_ROLES is isStaff()', () => {
    expect(sorted(helperRoles(RULES, 'isStaff'))).toEqual(sorted(STAFF_ROLES));
  });

  it('BOOK_ROLES is worksTheBook()', () => {
    expect(sorted(helperRoles(RULES, 'worksTheBook'))).toEqual(
      sorted(BOOK_ROLES),
    );
  });

  it('MONEY_ROLES is the front desk', () => {
    const twin = moneyTwin(RULES);
    expect(sorted(twin.roles), twin.source).toEqual(sorted(MONEY_ROLES));
  });

  it('every role the rules name is a UserRole', () => {
    const named = new Set<string>();
    for (const list of RULES.matchAll(
      /(?:hasAnyRole|roles\(\)\s*\.\s*hasAny)\(\s*\[([^\]]*)\]/g,
    )) {
      for (const role of roleLiterals(list[1] ?? '')) named.add(role);
    }
    expect(named.size).toBeGreaterThan(0);
    const strangers = [...named].filter(
      (role) => !(USER_ROLES as readonly string[]).includes(role),
    );
    expect(strangers).toEqual([]);
  });
});
