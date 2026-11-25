import {
  DestroyRef,
  InjectionToken,
  type Injector,
  type WritableSignal,
  afterNextRender,
} from '@angular/core';

/**
 * WHETHER A HEAVY SHEET BUILDS IN STAGES (owner, 2026-11-07: "it has to be
 * like game buttery smooth"). Building a whole editor in the tap's frame
 * was one long task — the visit sheet's 120–140 ms, the block sheet's
 * 80–110 ms on a 4×-throttled phone build — and the sheet's slide could
 * not start until it ended. Staged, the tap's frame builds the sheet's
 * chrome and dock, so the slide starts at once, and the editor's content
 * follows a step at a time while the sheet is still low (`climbStages`).
 *
 * `true` in the app. A spec that reads an editor's rows at once provides
 * `false`; each editor's staging has its own case.
 */
export const SHEET_STAGED = new InjectionToken<boolean>('SHEET_STAGED', {
  providedIn: 'root',
  factory: () => true,
});

/**
 * Raises `stage` by one, two frames after each step was drawn, until it
 * reaches `last`. The first frame starts the sheet's slide, the second has
 * handed it to the compositor, so the build that follows cannot hold the
 * slide back. The stage only climbs: an editor whose pages rebuild its
 * ladder rebuilds it whole.
 *
 * A sheet closed between a step's two frames cancels the frame it waits
 * on. Angular drops a pending `afterNextRender` with its view, but not a
 * frame: the step would land on the destroyed sheet, whose view and
 * injector refuse the next `afterNextRender` (NG0911, NG0205).
 */
export function climbStages(
  stage: WritableSignal<number>,
  last: number,
  injector: Injector,
): void {
  let frame = 0;
  const step = (): void => {
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const next = stage() + 1;
        stage.set(next);
        if (next < last) afterNextRender(step, { injector });
      });
    });
  };
  injector.get(DestroyRef).onDestroy(() => cancelAnimationFrame(frame));
  afterNextRender(step, { injector });
}
