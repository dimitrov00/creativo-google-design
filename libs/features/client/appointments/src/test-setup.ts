import '@angular/compiler';
import '@analogjs/vitest-angular/setup-snapshots';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

setupTestBed();

// jsdom lays nothing out and ships no `scrollIntoView`, so the calendar's
// scroll-to-today (polish no spec observes) threw a TypeError into the log of
// every calendar test. Every browser this page runs in has it; only the test
// DOM gets the no-op.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => undefined;
}
