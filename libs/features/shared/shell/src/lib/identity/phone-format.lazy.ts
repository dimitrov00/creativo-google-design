/**
 * The phone formatter, loaded lazily by the shell's identity label (F6,
 * Phase 4a §9 R10): a component-local NAMED re-export, never a dynamic
 * import of the `@core/systems` namespace — so `PhoneSystem` and
 * `libphonenumber-js` land in this lazy chunk, not the initial one.
 */
export { PhoneSystem } from '@core/systems';
