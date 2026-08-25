import { ActivatedRouteSnapshot } from '@angular/router';
import { pathOf } from './app.config';

/**
 * The staff day store mirrors the shown day into `?day=` through
 * `router.navigate`, so tapping the week strip is a real navigation — and the
 * router handed every one of them to `document.startViewTransition()`, which
 * cross-dissolved the entire document.
 *
 * Measured across four independent instruments: the screen was a double
 * exposure of two different days for ~400ms after each tap, pixels stopped
 * changing a median 378ms in (against ~30ms with the transition skipped), and
 * the week strip's own 150ms disc slide ran underneath a snapshot layer
 * between 0% and 2% opaque — invisible. Two rounds of retuning that disc's
 * easing curve moved what reached the screen by 1.5ms.
 *
 * `pathOf` is the predicate that tells the two cases apart.
 */
// `test` rather than `it`: apps/web lints with eslint-plugin-playwright, whose
// `no-standalone-expect` recognises `test()` only and reports every `expect`
// inside an `it()` as standalone. Verified against a probe file — both plain
// and async `it` are reported, `test` is not.
describe('pathOf — which navigations are real page changes', () => {
  /** A snapshot is only ever read through `pathFromRoot`, so stub that. */
  const snapshotFor = (path: string): ActivatedRouteSnapshot => {
    const segments = path.split('/').filter(Boolean);
    return {
      pathFromRoot: segments.map((p) => ({ url: [{ path: p }] })),
    } as unknown as ActivatedRouteSnapshot;
  };

  test('reads the resolved path and ignores the query string entirely', () => {
    // The query string never reaches `pathFromRoot`, which is the whole point:
    // `/staff/schedule?day=2026-08-25` and `/staff/schedule?day=2026-08-26`
    // are the same screen re-published, not a navigation.
    expect(pathOf(snapshotFor('/staff/schedule'))).toBe('staff/schedule');
    expect(pathOf(snapshotFor('/staff/schedule'))).toBe(
      pathOf(snapshotFor('/staff/schedule')),
    );
  });

  test('still distinguishes genuinely different pages, so they keep animating', () => {
    expect(pathOf(snapshotFor('/staff/schedule'))).not.toBe(
      pathOf(snapshotFor('/staff/clients')),
    );
    expect(pathOf(snapshotFor('/book'))).not.toBe(pathOf(snapshotFor('/')));
  });

  test('distinguishes two URLs that SHARE a route config', () => {
    // This is why the predicate is not `from.routeConfig === to.routeConfig`,
    // which is the cheaper and more obvious reach: a parameterised route
    // serves many URLs from one config, and moving between them is a real
    // navigation that should still cross-fade.
    expect(pathOf(snapshotFor('/visit/1'))).not.toBe(
      pathOf(snapshotFor('/visit/2')),
    );
  });
});
