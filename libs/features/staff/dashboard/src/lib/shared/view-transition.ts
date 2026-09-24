import { DOCUMENT } from '@angular/common';
import { Injector, afterNextRender } from '@angular/core';

/**
 * ONE STATE CHANGE, ANIMATED BY THE PLATFORM — the recipe the frame's full
 * screen has used since 2026-09-10, lifted out so the schedule's view
 * switch can use the same one (2026-09-23, the grid views' design record
 * §10; reuse, never copy).
 *
 * `document.startViewTransition` snapshots the page, runs the update, and
 * cross-fades (or morphs, where an element carries a `view-transition-name`)
 * to the new picture. Where the platform has none, or motion is reduced,
 * the update simply applies. Either way `settled` runs once the DOM has
 * its new shape — BEFORE a transition takes its new snapshot, so a caller
 * that scrolls something into place in `settled` animates to the placed
 * picture, not to the one before it.
 *
 * The update is applied inside the transition's own callback and Angular's
 * next render is awaited through `afterNextRender`, which is what makes the
 * new snapshot the rendered one rather than the one a signal write has not
 * yet reached the DOM with.
 */
export function runViewTransition(
  update: () => void,
  injector: Injector,
  settled?: () => void,
): void {
  const document = injector.get(DOCUMENT) as Document & {
    startViewTransition?: (update: () => Promise<void>) => {
      finished: Promise<void>;
    };
  };
  const still =
    document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')
      .matches ?? false;
  if (typeof document.startViewTransition !== 'function' || still) {
    update();
    afterNextRender(() => settled?.(), { injector });
    return;
  }
  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        update();
        afterNextRender(
          () => {
            settled?.();
            resolve();
          },
          { injector },
        );
      }),
  );
  // Remembered until it is over, for anyone who must not start a second one
  // — see `settledViewTransition`. A skipped transition rejects; either way
  // it is finished.
  const finished = transition.finished.then(
    () => undefined,
    () => undefined,
  );
  active = finished;
  void finished.then(() => {
    if (active === finished) active = null;
  });
}

let active: Promise<void> | null = null;

/**
 * Resolves once no transition started here is still running.
 *
 * The platform allows ONE view transition at a time: starting another skips
 * the running one mid-animation. The router starts one on every navigation
 * (`withViewTransitions`), so the schedule's URL write — which follows a
 * view switch by a tick — waited on nothing and cut the canvas's cross-fade
 * a few milliseconds in (found in review, 2026-09-23). Anything that
 * navigates after an animated state change waits here first.
 */
export function settledViewTransition(): Promise<void> {
  return active ?? Promise.resolve();
}
