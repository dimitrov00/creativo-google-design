import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { noSlicedPorts } from './no-sliced-ports.mjs';

const tester = new RuleTester({
  languageOptions: { parser: tsParser },
});

tester.run('creativo/no-sliced-ports', noSlicedPorts, {
  valid: [
    // Bundles composed bottom-up.
    { code: 'export type P = CommitPorts & ClockPorts & PolicyReadPorts;' },
    { code: 'export type P = SchedulingReadPorts;' },
    // A slice of an entity or a data type is not a port bundle…
    { code: "export type F = Pick<User, 'firstName' | 'lastName'>;" },
    { code: "export type G = Omit<Appointment, 'id'>;" },
    // …and a type merely ending in `Port` (singular) is not a bundle.
    { code: "export type H = Pick<LegacyPort, 'load'>;" },
    // Indexed access names one member's type — no slice.
    { code: "export type L = SchedulingPorts['loadPolicy'];" },
    { code: 'export type M = Partial<AccountAppointmentReadPorts>;' },
  ],
  invalid: [
    {
      code: "export type P = Pick<SchedulingPorts, 'loadPolicy'>;",
      errors: [{ messageId: 'slicedPorts' }],
    },
    {
      code: "export type P = Omit<AppointmentPhotoPorts, 'uploadPhotoBytes'>;",
      errors: [{ messageId: 'slicedPorts' }],
    },
    {
      // Wrapped, qualified, intersected — still a slice of a bundle.
      code: "export type P = Partial<Pick<Ports.AppointmentReadPorts, 'observeHistory'>>;",
      errors: [{ messageId: 'slicedPorts' }],
    },
    {
      code: "export type P = Pick<TxPorts & TelemetryPorts, 'commit' | 'log'>;",
      errors: [{ messageId: 'slicedPorts' }],
    },
    {
      code: "export const f = (ports: Pick<TxPorts, 'nowUtcMs'>) => ports.nowUtcMs();",
      errors: [{ messageId: 'slicedPorts' }],
    },
    {
      // The ports tier's strict mode: no Pick/Omit at all.
      code: "export type U = (photo: Omit<AppointmentPhoto, 'path' | 'url'>) => void;",
      options: [{ anyType: true }],
      errors: [{ messageId: 'slicedInPorts' }],
    },
    {
      code: "export type C = Pick<User, 'firstName'>;",
      options: [{ anyType: true }],
      errors: [{ messageId: 'slicedInPorts' }],
    },
    {
      // One report per slice, the bundle message first.
      code: "export type P = Pick<CatalogPorts, 'loadCatalog'>;",
      options: [{ anyType: true }],
      errors: [{ messageId: 'slicedPorts' }],
    },
  ],
});
