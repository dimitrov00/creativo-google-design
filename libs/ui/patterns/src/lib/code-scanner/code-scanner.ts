import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CAMERA_MEDIA, isCameraSupported } from '../camera/camera-media';

/** One code the camera read. */
export interface CodeDetection {
  readonly rawValue: string;
}

/** What reads a frame — the engine's `BarcodeDetector`, or a double. */
export interface CodeDetector {
  detect(source: HTMLVideoElement): Promise<readonly CodeDetection[]>;
}

export type CodeScannerState =
  'starting' | 'scanning' | 'denied' | 'unsupported' | 'done';

/** The scanner's camera IS the DS camera (`CAMERA_MEDIA`, 2026-09-17); the name stays for the scanner's own callers. */
export const CODE_SCANNER_MEDIA = CAMERA_MEDIA;

/** The detector the engine has — `BarcodeDetector` — or `null` where it has none. */
export const CODE_SCANNER_DETECTOR = new InjectionToken<
  ((formats: readonly string[]) => CodeDetector) | null
>('CodeScannerDetector', {
  providedIn: 'root',
  factory: () => {
    const ctor = (
      globalThis as {
        BarcodeDetector?: new (options: {
          formats: readonly string[];
        }) => CodeDetector;
      }
    ).BarcodeDetector;
    return ctor === undefined ? null : (formats) => new ctor({ formats });
  },
});

/**
 * Whether this engine can scan at all — the detector and a camera. A host
 * shows a scan button only when this is true (HIG: never offer a control
 * that cannot work); typing stays the way in everywhere.
 */
export function isCodeScannerSupported(): boolean {
  const scope = globalThis as { BarcodeDetector?: unknown };
  return typeof scope.BarcodeDetector === 'function' && isCameraSupported();
}

/** The codes a voucher or a coupon is printed with. */
const DEFAULT_FORMATS: readonly string[] = [
  'qr_code',
  'code_128',
  'code_39',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
];

/**
 * THE CODE SCANNER — a viewfinder that reads the first QR or barcode it
 * sees and says so once (owner, 2026-09-16: "for the voucher, scan a QR
 * code or barcode — they are too much to type — but allow both").
 *
 * The camera is asked for when the view is up, never before (HIG, privacy:
 * ask at the moment of use, in context); a refusal is said in words and
 * the host's typed field stays the way in. Frames are read on a timer
 * through the engine's own `BarcodeDetector`, so nothing is decoded by
 * hand; the first non-empty read ends the scan, the camera is released,
 * and `uiDetected` carries the trimmed value. Both the camera and the
 * detector come through injection tokens, so a test drives the scanner
 * with doubles and a host can swap the reader.
 *
 * Copy is the host's: the four states are said in the host's words.
 */
@Component({
  selector: 'ui-code-scanner',
  template: `
    <div class="ui-code-scanner__view">
      <video
        #video
        class="ui-code-scanner__video"
        autoplay
        muted
        playsinline
      ></video>
      @if (state() === 'scanning') {
        <span class="ui-code-scanner__frame" aria-hidden="true"></span>
      }
    </div>
    <p class="ui-code-scanner__status" role="status" aria-live="polite">
      {{ statusText() }}
    </p>
  `,
  styleUrl: './code-scanner.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-code-scanner',
    '[attr.data-state]': 'state()',
  },
})
export class UiCodeScanner implements AfterViewInit {
  private readonly media = inject(CODE_SCANNER_MEDIA);
  private readonly makeDetector = inject(CODE_SCANNER_DETECTOR);
  private readonly video =
    viewChild.required<ElementRef<HTMLVideoElement>>('video');

  readonly uiFormats = input<readonly string[]>(DEFAULT_FORMATS);
  /** How often a frame is read, in milliseconds. */
  readonly uiInterval = input(250);
  readonly uiStarting = input('');
  readonly uiScanning = input('');
  readonly uiDenied = input('');
  readonly uiUnsupported = input('');

  /** The first code read, trimmed — said once; the camera is released with it. */
  readonly uiDetected = output<string>();
  readonly uiStateChange = output<CodeScannerState>();

  protected readonly state = signal<CodeScannerState>('starting');

  protected readonly statusText = computed(() => {
    switch (this.state()) {
      case 'starting':
        return this.uiStarting();
      case 'scanning':
      case 'done':
        return this.uiScanning();
      case 'denied':
        return this.uiDenied();
      case 'unsupported':
        return this.uiUnsupported();
    }
  });

  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  ngAfterViewInit(): void {
    void this.start();
  }

  private async start(): Promise<void> {
    if (this.makeDetector === null) {
      this.setState('unsupported');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await this.media();
    } catch {
      this.setState('denied');
      return;
    }
    if (this.stopped) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    const video = this.video().nativeElement;
    try {
      video.srcObject = stream;
      await video.play();
    } catch {
      // An engine that will not autoplay still paints the stream once the
      // element is on screen; the detector reads whatever is painted.
    }
    this.setState('scanning');
    this.tick(this.makeDetector(this.uiFormats()));
  }

  private tick(detector: CodeDetector): void {
    this.timer = setTimeout(async () => {
      if (this.stopped) return;
      try {
        const found = await detector.detect(this.video().nativeElement);
        const hit = found.find((code) => code.rawValue.trim().length > 0);
        if (hit !== undefined) {
          this.setState('done');
          this.stop();
          this.uiDetected.emit(hit.rawValue.trim());
          return;
        }
      } catch {
        // A frame that cannot be read is skipped; the next one may.
      }
      if (!this.stopped) this.tick(detector);
    }, this.uiInterval());
  }

  /** Lets the camera go; safe to call twice. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private setState(state: CodeScannerState): void {
    this.state.set(state);
    this.uiStateChange.emit(state);
  }
}
