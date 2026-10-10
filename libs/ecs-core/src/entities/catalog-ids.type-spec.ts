import { BarberId } from './barber.entity';
import { CourseId } from './course.entity';
import { EventId } from './event.entity';
import { LocationId } from './location.entity';
import { PositionId } from './position.entity';
import { ServiceCategoryId } from './service-category.entity';
import { ServiceId } from './service.entity';
import { ServiceVariantId } from '../components/service-terms.data';

/**
 * Compile-time-only assertions for the catalogue and programs id brands — no
 * runtime `expect()`/`it()`, run by `nx typecheck` through
 * `tsconfig.spec.json`. Proves (a) a bare `string` cannot stand in for a
 * branded id, (b) the brands are not interchangeable although every one is a
 * plain string at run time, and (c) `XId.of(raw)` is the way in and the
 * brand still reads as a string.
 */

declare function requireServiceId(id: ServiceId): void;
declare function requireServiceCategoryId(id: ServiceCategoryId): void;
declare function requireBarberId(id: BarberId): void;
declare function requireLocationId(id: LocationId): void;
declare function requirePositionId(id: PositionId): void;
declare function requireCourseId(id: CourseId): void;
declare function requireEventId(id: EventId): void;
declare function requireServiceVariantId(id: ServiceVariantId): void;

// (a) A plain string is rejected where a branded id is expected.
// @ts-expect-error — a bare string is not a ServiceId; it must come from ServiceId.of().
requireServiceId('svc-classic-cut');
// @ts-expect-error — a bare string is not a ServiceCategoryId.
requireServiceCategoryId('cat-cuts');
// @ts-expect-error — a bare string is not a BarberId.
requireBarberId('ivan');
// @ts-expect-error — a bare string is not a LocationId.
requireLocationId('loc-center');
// @ts-expect-error — a bare string is not a PositionId.
requirePositionId('pos-barber');
// @ts-expect-error — a bare string is not a CourseId.
requireCourseId('course-1');
// @ts-expect-error — a bare string is not an EventId.
requireEventId('event-1');
// @ts-expect-error — a bare string is not a ServiceVariantId.
requireServiceVariantId('short');

// (b) The brands are nominal: none substitutes for another.
const serviceId = ServiceId.of('svc-classic-cut');
const categoryId = ServiceCategoryId.of('cat-cuts');
const barberId = BarberId.of('ivan');
const locationId = LocationId.of('loc-center');
const positionId = PositionId.of('pos-barber');
const courseId = CourseId.of('course-1');
const eventId = EventId.of('event-1');
const variantId = ServiceVariantId.of('short');

// @ts-expect-error — a BarberId cannot substitute for a LocationId.
requireLocationId(barberId);
// @ts-expect-error — a ServiceId cannot substitute for a BarberId.
requireBarberId(serviceId);
// @ts-expect-error — a LocationId cannot substitute for a ServiceId.
requireServiceId(locationId);
// @ts-expect-error — a ServiceCategoryId cannot substitute for a ServiceId.
requireServiceId(categoryId);
// @ts-expect-error — a ServiceVariantId cannot substitute for a ServiceId.
requireServiceId(variantId);
// @ts-expect-error — a CourseId cannot substitute for a PositionId.
requirePositionId(courseId);
// @ts-expect-error — an EventId cannot substitute for a CourseId.
requireCourseId(eventId);
// @ts-expect-error — a PositionId cannot substitute for an EventId.
requireEventId(positionId);

// (c) `.of` is the way in, and a brand still reads as its stored string.
requireServiceId(serviceId);
requireServiceCategoryId(categoryId);
requireBarberId(barberId);
requireLocationId(locationId);
requirePositionId(positionId);
requireCourseId(courseId);
requireEventId(eventId);
requireServiceVariantId(variantId);
const stored: string = barberId;
void stored;
