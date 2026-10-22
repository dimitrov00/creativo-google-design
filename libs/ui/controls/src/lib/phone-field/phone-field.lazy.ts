/**
 * The phone field's lazy chunk (owner ruling F6; phase-4a §9 R10). The field
 * loads it with `import('./phone-field.lazy')`, so `PhoneSystem` and the
 * `libphonenumber-js` metadata it rides (~170 kB) arrive only when the first
 * phone field constructs — never in an initial bundle that merely imports
 * the `@creativo/ui/controls` barrel.
 *
 * A NAMED re-export on purpose: `@core/systems` is already static on the
 * eager path, and a dynamic import of that barrel's NAMESPACE would keep
 * every `export *` alive beside it — `phone.system.ts` and the metadata in
 * `main`. Through this module the bundler places `PhoneSystem` by its users.
 */
export { PhoneSystem } from '@core/systems';
