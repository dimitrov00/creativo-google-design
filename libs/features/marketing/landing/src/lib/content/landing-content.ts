/**
 * The landing's one hand-authored list: the work strip's shots and their
 * art direction. Everything else the page shows is stored — the services,
 * the barbers and the shops are the catalogue's (`CatalogContentService`,
 * behind `LandingContentService`), and the demo catalogue the specs serve
 * through the catalogue's ports is test support
 * (`src/testing/landing-catalog.ts`).
 */

import { InjectionToken } from '@angular/core';
import type { LocalizedText } from '@core/components';

// ─── Work gallery ───────────────────────────────────────────────────────

/** Editorial art direction — per-shot aspect boxes, parallax drift and
 *  caption. Order IS the strip order (v2 `work-gallery.tsx` ART_DIRECTION). */
export interface WorkShotVm {
  readonly id: string;
  readonly src: string;
  readonly alt: LocalizedText;
  readonly aspectRatio: string;
  readonly driftY: number;
  readonly caption: LocalizedText;
}

/**
 * The shop's own work, as the «Нашата работа» strip shows it — EMPTY, and
 * the strip with its nav entries hidden, until the owner supplies photos of
 * the shop's real work (owner, 2026-11-19: the six bundled `/work/*.jpg`
 * shots it carried were not, and one showed another shop's people). The
 * specs' demo strip is test support (`src/testing/landing-catalog.ts`).
 */
export const LANDING_WORK_SHOTS = new InjectionToken<readonly WorkShotVm[]>(
  'LANDING_WORK_SHOTS',
  { providedIn: 'root', factory: () => [] },
);
