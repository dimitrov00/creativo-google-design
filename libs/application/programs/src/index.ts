export * from './lib/ports/position-repository.port';
export * from './lib/ports/course-repository.port';
export * from './lib/ports/shop-event-repository.port';

export * from './lib/use-cases/observe-open-positions.use-case';
export * from './lib/use-cases/observe-courses.use-case';
export * from './lib/use-cases/observe-upcoming-shop-events.use-case';
export * from './lib/use-cases/observe-past-shop-events.use-case';
export * from './lib/use-cases/observe-all-positions.use-case';
export * from './lib/use-cases/observe-all-courses.use-case';

export * from './lib/use-cases/create-position.use-case';
export * from './lib/use-cases/create-position.errors';
export * from './lib/use-cases/update-position.use-case';
export * from './lib/use-cases/update-position.errors';

export * from './lib/use-cases/create-course.use-case';
export * from './lib/use-cases/create-course.errors';
export * from './lib/use-cases/update-course.use-case';
export * from './lib/use-cases/update-course.errors';

export * from './lib/use-cases/create-shop-event.use-case';
export * from './lib/use-cases/create-shop-event.errors';
export * from './lib/use-cases/update-shop-event.use-case';
export * from './lib/use-cases/update-shop-event.errors';

// Facade re-export (blueprint §1.2 layering) — see `application/booking`'s
// identical re-export for the full rationale; the careers/courses/events
// pages (`type:feature`) need `Position`/`Course`/`ShopEvent` nameable
// without an illegal `type:domain` import of their own.
export * from '@creativo/domain/programs';
export type { DomainError, Result } from '@creativo/domain/kernel';
export { combine, fail, ok } from '@creativo/domain/kernel';
