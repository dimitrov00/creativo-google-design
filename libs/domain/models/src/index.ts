// Kernel primitives (value objects, Result)
export * from './lib/ids';
export * from './lib/ids.errors';
export * from './lib/email';
export * from './lib/email.errors';
export * from './lib/role';
export * from './lib/session-claims';
export * from './lib/session-claims.errors';
export * from './lib/working-hours';
export * from './lib/working-hours.errors';
export * from './lib/appointment-status';

// Entities / aggregates
// (the legacy foundation-pass `User` lived here until the greenfield
// schema unification — `domain/accounts`' `User` is THE user aggregate
// now, persisted identically by `apps/functions` and the web adapter)
export * from './lib/tenant';
export * from './lib/tenant.errors';
export * from './lib/staff';
export * from './lib/staff.errors';
export * from './lib/service';
export * from './lib/service.errors';
export * from './lib/appointment';
export * from './lib/appointment.errors';
export * from './lib/otp';
export * from './lib/otp.errors';
