import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CAMERA_MEDIA, isCameraRefusal } from './camera-media';

export type CameraCaptureState =
  'starting' | 'ready' | 'denied' | 'unsupported' | 'done';

/**
 * THE CAMERA CAPTURE — a viewfinder that takes ONE picture (owner,
 * 2026-09-17: "take a photo doesn't open the camera"): what the frame
 * shows is exactly what the shutter takes, cropped to the picture's own
 * shape, as a JPEG. The camera is asked for when the view is up, never
 * before (HIG, privacy: at the moment of use, in context); a refusal is
 * said in words and the host keeps its other way in. The shutter is the
 * HOST's — a dock button calls `shoot()` — so the viewfinder never
 * carries a control of its own under the thumb; the picture is said once
 * through `uiCaptured`, and the camera is released with it. The camera
 * comes through the DS's one camera token, so a test drives it with a
 * double. Copy is the host's: the four states are said in its words.
 */
@Component({
  selector: 'ui-camera-capture',
  template: `
    <div class="ui-camera-capture__view">
      <video
        #video
        class="ui-camera-capture__video"
        autoplay
        muted
        playsinline
      ></video>
    </div>
    <p class="ui-camera-capture__status" role="status" aria-live="polite">
      {{ statusText() }}
    </p>
  `,
  styleUrl: './camera-capture.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-camera-capture',
    '[attr.data-state]': 'state()',
    '[style.--ui-camera-capture-ratio]': 'uiRatio()',
  },
})
export class UiCameraCapture implements AfterViewInit {
  private readonly media = inject(CAMERA_MEDIA);
  private readonly video =
    viewChild.required<ElementRef<HTMLVideoElement>>('video');

  /** The picture's shape, width over height — the viewfinder shows exactly what is taken. */
  readonly uiRatio = input(3 / 4);
  /** JPEG quality of the picture taken. */
  readonly uiQuality = input(0.92);
  readonly uiStarting = input('');
  readonly uiReady = input('');
  readonly uiDenied = input('');
  readonly uiUnsupported = input('');

  /** The picture, as a JPEG — said once; the camera is released with it. */
  readonly uiCaptured = output<Blob>();
  readonly uiStateChange = output<CameraCaptureState>();

  protected readonly state = signal<CameraCaptureState>('starting');
  /** Whether the shutter would take a picture now. */
  readonly ready = computed(() => this.state() === 'ready');

  protected readonly statusText = computed(() => {
    switch (this.state()) {
      case 'starting':
        return this.uiStarting();
      case 'ready':
      case 'done':
        return this.uiReady();
      case 'denied':
        return this.uiDenied();
      case 'unsupported':
        return this.uiUnsupported();
    }
  });

  private stream: MediaStream | null = null;
  private stopped = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  ngAfterViewInit(): void {
    void this.start();
  }

  private async start(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await this.media();
    } catch (error) {
      // A person or a policy said no; anything else is an engine with no
      // camera to ask (`navigator.mediaDevices` missing, a bare context).
      this.setState(isCameraRefusal(error) ? 'denied' : 'unsupported');
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
      // element is on screen; the shutter reads whatever is painted.
    }
    this.setState('ready');
  }

  /**
   * THE SHUTTER: the frame as the viewfinder shows it — the largest box of
   * the picture's shape inside the camera's frame, centred, as `cover`
   * draws it — at the camera's own resolution, as a JPEG. `false` when
   * there is nothing to take yet.
   */
  async shoot(): Promise<boolean> {
    if (this.state() !== 'ready') return false;
    const video = this.video().nativeElement;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (sourceWidth === 0 || sourceHeight === 0) return false;
    const ratio = this.uiRatio();
    let width = sourceWidth;
    let height = Math.round(sourceWidth / ratio);
    if (height > sourceHeight) {
      height = sourceHeight;
      width = Math.round(sourceHeight * ratio);
    }
    const x = Math.round((sourceWidth - width) / 2);
    const y = Math.round((sourceHeight - height) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) return false;
    context.drawImage(video, x, y, width, height, 0, 0, width, height);
    const picture = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', this.uiQuality()),
    );
    if (picture === null) return false;
    this.setState('done');
    this.stop();
    this.uiCaptured.emit(picture);
    return true;
  }

  /** Lets the camera go; safe to call twice. */
  stop(): void {
    this.stopped = true;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private setState(state: CameraCaptureState): void {
    this.state.set(state);
    this.uiStateChange.emit(state);
  }
}
