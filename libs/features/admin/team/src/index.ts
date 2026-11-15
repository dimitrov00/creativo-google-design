/*
 * THE TEAM LIST, the library's main entry (`@creativo/features/admin/team`).
 * Each of the Team's other screens has an entry of its own — `…/team/
 * permissions`, `…/team/member`, `…/team/account` (the `*.route.ts` files
 * beside this one) — so a route loads its own page and what it shares with
 * the others, never all of them: together they sat at the route's ceiling.
 */
export * from './lib/admin-team/admin-team';
