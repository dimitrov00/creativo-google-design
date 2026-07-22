export * from './lib/ports/profile.port';
export * from './lib/ports/contact-change-target';
export * from './lib/ports/confirmation-code.errors';
export * from './lib/ports/confirmation-code';
export * from './lib/ports/contact-change.errors';
export * from './lib/ports/contact-change.port';
export * from './lib/ports/avatar-uploader.errors';
export * from './lib/ports/avatar-uploader.port';
export * from './lib/use-cases/update-profile.errors';
export * from './lib/use-cases/update-profile.use-case';
export * from './lib/use-cases/confirm-contact-change.errors';
export * from './lib/use-cases/confirm-contact-change.use-case';
export * from './lib/use-cases/upload-avatar.errors';
export * from './lib/use-cases/upload-avatar.use-case';

// Facade re-export (blueprint §1.2 layering) — see
// `libs/application/identity`'s identical re-export for the full rationale;
// the `client/account` dashboard (goal 6.3) needs `User`/`UserId` nameable
// without reaching past this layer.
export * from '@creativo/domain/accounts';
// `ZonedDateTime` (blueprint §2.2) is the one piece of `domain/kernel` every
// `User.create`/`reconstitute` call needs (the birth-date age check takes an
// explicit clock instant) — re-exported for the same reason as `identity`'s
// `Result`/`ok`/`fail`: feature-layer components/tests build `User`
// instances without an illegal `type:domain` import of their own.
export { ZonedDateTime } from '@creativo/domain/kernel';
