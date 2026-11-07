import { InjectionToken } from '@angular/core';

/**
 * WHETHER THE VISIT SHEET BUILDS IN TWO STAGES (owner, 2026-11-07: "it has
 * to be like game buttery smooth"). Building the whole ladder in the tap's
 * frame was one 140 ms task on a 4×-throttled phone build: the sheet held
 * its first frame while Angular made ~420 elements and the browser styled
 * them. Staged, the tap's frame builds what the first screen shows — the
 * chairs, the services, the frame and the people — and the next frame
 * builds what sits under the dock: the shop, the team's note, the photos,
 * the bill and the exits.
 *
 * `true` in the app. A spec that reads the lower rows at once provides
 * `false`; the staging itself has its own case.
 */
export const VISIT_SHEET_STAGED = new InjectionToken<boolean>(
  'VISIT_SHEET_STAGED',
  { providedIn: 'root', factory: () => true },
);
