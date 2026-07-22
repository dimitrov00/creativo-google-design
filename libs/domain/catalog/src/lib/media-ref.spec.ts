import { describe, expect, it } from 'vitest';
import { FocalPoint, MediaRef } from './media-ref';

function validProps() {
  return {
    id: 'media_1',
    path: 'barbers/ivan/avatar.jpg',
    width: 800,
    height: 800,
    blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
    focalPoint: { x: 0.5, y: 0.4 },
  };
}

describe('FocalPoint.create', () => {
  it('accepts coordinates within 0..1', () => {
    const result = FocalPoint.create({ x: 0, y: 1 });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.x).toBe(0);
      expect(result.value.y).toBe(1);
    }
  });

  it('rejects an out-of-range coordinate', () => {
    expect(FocalPoint.create({ x: -0.1, y: 0.5 }).isFailure()).toBe(true);
    expect(FocalPoint.create({ x: 0.5, y: 1.1 }).isFailure()).toBe(true);
  });

  it('center() returns the normalized midpoint', () => {
    const center = FocalPoint.center();
    expect(center.x).toBe(0.5);
    expect(center.y).toBe(0.5);
  });

  it('equals() compares both axes', () => {
    const a = FocalPoint.center();
    const b = FocalPoint.center();
    expect(a.equals(b)).toBe(true);
  });
});

describe('MediaRef.create', () => {
  it('accepts fully valid props', () => {
    const result = MediaRef.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.path).toBe('barbers/ivan/avatar.jpg');
      expect(result.value.width).toBe(800);
      expect(result.value.height).toBe(800);
      expect(result.value.blurhash).toBe('L6PZfSi_.AyE_3t7t7R**0o#DgR4');
      expect(result.value.focalPoint?.x).toBe(0.5);
    }
  });

  it('accepts omitted blurhash/focalPoint', () => {
    const result = MediaRef.create({
      id: 'media_1',
      path: 'barbers/ivan/avatar.jpg',
      width: 800,
      height: 800,
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.blurhash).toBeNull();
      expect(result.value.focalPoint).toBeNull();
    }
  });

  it('rejects an empty id', () => {
    expect(MediaRef.create({ ...validProps(), id: '' }).isFailure()).toBe(true);
  });

  it('rejects an empty path', () => {
    expect(MediaRef.create({ ...validProps(), path: '  ' }).isFailure()).toBe(
      true,
    );
  });

  it('rejects a non-positive width or height', () => {
    expect(MediaRef.create({ ...validProps(), width: 0 }).isFailure()).toBe(
      true,
    );
    expect(MediaRef.create({ ...validProps(), height: -5 }).isFailure()).toBe(
      true,
    );
  });

  it('rejects a non-integer dimension', () => {
    expect(MediaRef.create({ ...validProps(), width: 10.5 }).isFailure()).toBe(
      true,
    );
  });

  it('rejects an out-of-range focal point', () => {
    const result = MediaRef.create({
      ...validProps(),
      focalPoint: { x: 2, y: 0.5 },
    });
    expect(result.isFailure()).toBe(true);
  });

  it('collects every invalid field at once', () => {
    const result = MediaRef.create({
      ...validProps(),
      id: '',
      width: 0,
      height: 0,
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('MediaRef.reconstitute', () => {
  it('validates identically to create()', () => {
    expect(MediaRef.reconstitute(validProps()).isSuccess()).toBe(true);
  });
});
