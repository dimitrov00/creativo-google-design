/**
 * `firestore.rules` read as TEXT — the ONE reader every rules-text spec
 * parses the file with, so no two specs can read the same rule differently:
 * the comment stripper, a `match` block, a helper's body, and the roles a
 * role-group helper or a block's `list` grant admits. It was three readers
 * (`role.rules-parity.spec.ts`, the firestore lib's `src/testing/rules-text.ts`
 * and `caller-roles.spec.ts`'s regex) until the next pass of 2026-11-03.
 *
 * Pure string functions over text the spec hands in: each spec reads the
 * file itself with node's `fs` (`@core/testing` stays free of node modules —
 * the web's unit-test build compiles it too).
 *
 * The role reader is deliberately small: it understands a helper whose body
 * is a single `return` of role checks joined by `||`, which is how every
 * role-group helper is written. Anything else (an `&&`, a `let`, a non-role
 * test) is refused by name rather than guessed at.
 */

/** Index of the quote closing the string literal that opens at `start`. */
function closingQuote(src: string, start: number): number {
  const quote = src.charAt(start);
  for (let i = start + 1; i < src.length; i++) {
    if (src.charAt(i) === '\\') i++;
    else if (src.charAt(i) === quote) return i;
  }
  throw new Error(`unterminated string at ${start}`);
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

const ROLE_CHECK = /^(?:hasAnyRole|roles\(\)\s*\.\s*hasAny)\s*\(/;
const HELPER_CALL = /^(\w+)\s*\(\s*\)$/;

/**
 * `match` heads. A path holds no whitespace, so it runs to the last `{`
 * before the block: its `{wildcard}` segments are braces too.
 */
const MATCH_HEAD = /\bmatch\s+(\/\S*)\s*\{/g;

/** `/users/{uid}` and `/users/{userId}` are the same path. */
const pathShape = (path: string) => path.replace(/\{[^}]*\}/g, '{}');

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
  if (call) return helperRolesAlong(rules, call[1] ?? '', trail);
  return undefined;
}

/** {@link helperRoles}, with the helpers already followed — a cycle is refused. */
function helperRolesAlong(
  rules: string,
  name: string,
  trail: readonly string[],
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

/** The rules text without its `//` and block comments — quoted strings kept whole. */
export function rulesCode(src: string): string {
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

/** The text of `match <path> { … }` in `rules`, braces balanced; throws when absent. */
export function blockOf(rules: string, path: string): string {
  const head = `match ${path} {`;
  const start = rules.indexOf(head);
  if (start === -1) throw new Error(`no ${head} in firestore.rules`);
  return rules.slice(start, closingBracket(rules, start + head.length - 1) + 1);
}

/** How often `needle` occurs in `text`. */
export function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** The body of the no-argument helper `name()`, or `undefined` when the rules define none. */
export function functionBody(rules: string, name: string): string | undefined {
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

/** The quoted roles of a list's inside (`'admin', "barber",`) — anything else is refused. */
export function roleLiterals(list: string): string[] {
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

/** The roles a role-group helper admits, following the helpers it calls. */
export function helperRoles(rules: string, name: string): ReadonlySet<string> {
  return helperRolesAlong(rules, name, []);
}

/** A `match` block's own statements, its nested `match` blocks cut out. */
export function ownStatements(rules: string, path: string): string {
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
export function listRoles(
  rules: string,
  statements: string,
): ReadonlySet<string> {
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
