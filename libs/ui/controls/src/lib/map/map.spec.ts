import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UiMap } from './map';
import { MAPLIBRE_SOURCES, type MapLibreSources } from './maplibre-loader';

afterEach(() => vi.restoreAllMocks());

describe('UiMap', () => {
  it('fails soft when MapLibre cannot be fetched — logs, leaves the pane empty, rejects nothing', async () => {
    const logged = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    // What a stale deploy or a dropped connection gives a lazy chunk.
    const offline = new TypeError(
      'Failed to fetch dynamically imported module',
    );
    const sources: MapLibreSources = {
      library: () => Promise.reject(offline),
      stylesheet: async () => '',
    };
    TestBed.configureTestingModule({
      providers: [{ provide: MAPLIBRE_SOURCES, useValue: sources }],
    });

    const fixture = TestBed.createComponent(UiMap);
    fixture.detectChanges();
    await fixture.whenStable();

    // Before the fix the load was awaited OUTSIDE the try: the rejection
    // escaped `initialise` unhandled and nothing was logged.
    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith(
        '[ui-map] failed to initialise:',
        offline,
      ),
    );
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-ui-map-canvas]')?.childElementCount).toBe(
      0,
    );
  });
});
