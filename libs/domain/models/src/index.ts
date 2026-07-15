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
export * from './lib/tenant';
export * from './lib/tenant.errors';
export * from './lib/user';
export * from './lib/user.errors';
export * from './lib/staff';
export * from './lib/staff.errors';
export * from './lib/service';
export * from './lib/service.errors';
export * from './lib/appointment';
export * from './lib/appointment.errors';
export * from './lib/otp';
export * from './lib/otp.errors';

// Ports
export * from './lib/ports/repository.errors';
export * from './lib/ports/otp-crypto.port';
export * from './lib/ports/otp-repository.port';
export * from './lib/ports/user-repository.port';
export * from './lib/ports/tenant-repository.port';
export * from './lib/ports/service-repository.port';
export * from './lib/ports/staff-repository.port';
export * from './lib/ports/appointment-repository.port';
export * from './lib/ports/clock.port';
export * from './lib/ports/otp-sender.port';
export * from './lib/ports/auth-token.port';
