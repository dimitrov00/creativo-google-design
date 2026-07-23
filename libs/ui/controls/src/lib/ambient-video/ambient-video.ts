import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  input,
  signal,
  viewChild,
} from '@angular/core';

/**
 * Custom element — autoplaying ambient background media with a poster
 * fallback (VideoPlayer/AsyncImage hybrid): the hero/hiring
 * poster-crossfade-reduced-motion trick, owned once.
 *
 * - Muted/looping/inline video sits over the poster; on `loadeddata` the
 *   host stamps `data-state="loaded"` and the film cross-fades in over
 *   `--sys-motion-duration-cinematic` (retires the off-ladder 1s literal).
 * - `prefers-reduced-motion` renders the poster only — no video element.
 * - Playback is fully internal: `play()` is called after first render and
 *   an autoplay rejection falls back to the poster. Owners call nothing.
 * - Decorative by default (`aria-hidden`); pass `uiLabel` to expose it as
 *   a labelled `img` instead.
 */
@Component({
  selector: 'ui-ambient-video',
  template: `
    <img class="ui-ambient-video__poster" [src]="uiPoster()" alt="" />
    @if (showVideo()) {
      <video
        #video
        class="ui-ambient-video__video"
        [src]="uiSrc()"
        muted
        loop
        playsinline
        preload="auto"
        (loadeddata)="loaded.set(true)"
      ></video>
    }
  `,
  styleUrl: './ambient-video.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-ambient-video',
    '[attr.data-state]': "loaded() ? 'loaded' : 'idle'",
    '[attr.role]': "uiLabel() ? 'img' : null",
    '[attr.aria-label]': 'uiLabel() || null',
    '[attr.aria-hidden]': "uiLabel() ? null : 'true'",
  },
})
export class UiAmbientVideo {
  readonly uiSrc = input.required<string>();
  readonly uiPoster = input.required<string>();
  readonly uiLabel = input<string | undefined>(undefined);

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  /** Client-resolved; SSR keeps the video markup and never plays it. */
  private readonly reducedMotion = signal(false);
  private readonly playbackFailed = signal(false);
  protected readonly loaded = signal(false);
  protected readonly showVideo = computed(
    () => !this.reducedMotion() && !this.playbackFailed(),
  );

  constructor() {
    // Browser-only by contract — never runs on the server. matchMedia is
    // feature-checked for DOM test environments (jsdom ships none).
    afterNextRender(() => {
      if (
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        this.reducedMotion.set(true);
        return;
      }
      const video = this.video()?.nativeElement;
      if (!video) return;
      // Property AND attribute: Chromium's autoplay policy checks the
      // property, which the content attribute alone doesn't always set.
      video.muted = true;
      // Some environments (jsdom) return undefined instead of a promise.
      const playback = video.play() as Promise<void> | undefined;
      playback?.catch(() => {
        // Autoplay rejected — drop the film, keep the poster.
        this.playbackFailed.set(true);
        this.loaded.set(false);
      });
    });
  }
}
