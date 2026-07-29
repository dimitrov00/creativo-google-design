export * from './lib/ports/notification-reader.port';
export * from './lib/stub/in-memory-notification-reader';

// Facade re-export (blueprint §1.2 layering) — `type:feature` libs may
// never reach past this layer for the aggregate they render.
export * from '@creativo/domain/notifications';
