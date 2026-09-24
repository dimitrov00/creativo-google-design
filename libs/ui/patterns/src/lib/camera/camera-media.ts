import { InjectionToken } from '@angular/core';

/**
 * THE CAMERA, as the DS asks for it: the back one, no sound — ONE token
 * every viewfinder shares. The code scanner reads codes through it and the
 * capture control takes pictures through it, so a test drives either with
 * a double and a host swaps the source once, for both.
 */
export const CAMERA_MEDIA = new InjectionToken<() => Promise<MediaStream>>(
  'CameraMedia',
  {
    providedIn: 'root',
    factory: () => () =>
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      }),
  },
);

/** Whether this engine has a camera to ask for at all. */
export function isCameraSupported(): boolean {
  const scope = globalThis as { navigator?: Navigator };
  return typeof scope.navigator?.mediaDevices?.getUserMedia === 'function';
}

/** A refusal by the person or the page's own policy — as opposed to an engine with no camera. */
export function isCameraRefusal(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    ((error as { name: unknown }).name === 'NotAllowedError' ||
      (error as { name: unknown }).name === 'SecurityError')
  );
}
