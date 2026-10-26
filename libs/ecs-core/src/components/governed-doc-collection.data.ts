import type { GovernedCollection } from './governed-collection.data';

/**
 * The thirteen governed collections whose writes become `GOVERNED_DOC_*`
 * rows — every {@link GovernedCollection} member but `USERS` (a users write
 * is a `PROFILE_*` row). A subset of the dictionary, read from it member by
 * member (the `ProfileAction` precedent: its own file, it has readers
 * outside `governed-collection.data.ts`); `GovernedChange` narrows on it.
 */
export type GovernedDocCollection =
  | typeof GovernedCollection.Settings
  | typeof GovernedCollection.Services
  | typeof GovernedCollection.Barbers
  | typeof GovernedCollection.Locations
  | typeof GovernedCollection.BarberSchedules
  | typeof GovernedCollection.ScheduleExceptions
  | typeof GovernedCollection.Coupons
  | typeof GovernedCollection.Positions
  | typeof GovernedCollection.Courses
  | typeof GovernedCollection.Events
  | typeof GovernedCollection.Customers
  | typeof GovernedCollection.AppointmentNotes
  | typeof GovernedCollection.AppointmentPhotos;
