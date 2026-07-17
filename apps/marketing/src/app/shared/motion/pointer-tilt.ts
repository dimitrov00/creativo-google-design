import { gsap } from 'gsap';

export interface PointerTiltOptions {
  readonly maxDegrees?: number;
  readonly duration?: number;
}

export function attachPointerTilt(
  frame: HTMLElement,
  options: PointerTiltOptions = {},
): () => void {
  const maxDegrees = options.maxDegrees ?? 14;
  const duration = options.duration ?? 0.6;

  const quickRotateY = gsap.quickTo(frame, 'rotateY', {
    duration,
    ease: 'power3.out',
  });
  const quickRotateX = gsap.quickTo(frame, 'rotateX', {
    duration,
    ease: 'power3.out',
  });

  const onMove = (event: PointerEvent) => {
    const rect = frame.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    quickRotateY(px * maxDegrees);
    quickRotateX(py * -maxDegrees);
  };
  const onLeave = () => {
    quickRotateY(0);
    quickRotateX(0);
  };

  frame.addEventListener('pointermove', onMove);
  frame.addEventListener('pointerleave', onLeave);

  return () => {
    frame.removeEventListener('pointermove', onMove);
    frame.removeEventListener('pointerleave', onLeave);
  };
}
