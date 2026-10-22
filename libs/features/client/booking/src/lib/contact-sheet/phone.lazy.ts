/**
 * The contact sheet's phone rules, loaded on first use (owner ruling F6:
 * the phone field lazily imports `@core/systems`). A NAMED re-export, never
 * a dynamic import of the `@core/systems` namespace — the eager graph
 * already holds that barrel, and importing the namespace lazily would
 * materialise every re-export (`libphonenumber-js` with it) in the chunk
 * that holds it. Through this file the bundler places `PhoneSystem` by its
 * users.
 */
export { PhoneSystem } from '@core/systems';
