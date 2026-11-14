/*
 * THE WEEKLY HOURS SHEET, on its own entry (`@creativo/features/staff/
 * dashboard/hours`): a page outside the schedule that raises it — a team
 * member's page — loads the sheet on demand, never the schedule. What the
 * sheet asks of its host is `…/dashboard/hours-desk`, which is small enough
 * to import up front.
 */
export * from './lib/staff-hours-sheet/staff-hours-sheet';
