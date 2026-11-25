/*
 * THE ACCOUNT MENU, on its own entry
 * (`@creativo/features/shared/shell/account-menu`): only a page with no site
 * header mounts it (the schedule), so it stays out of the shell barrel that
 * every route with the header loads — through the barrel it rode into each
 * of them (about 3 kB a route).
 */
export * from './lib/account-menu/account-menu.component';
