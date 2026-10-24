import { describe, expect, it } from 'vitest';
import { PhotoOrigin } from './photo-origin.data';

describe('PhotoOrigin', () => {
  it('keeps one SCREAMING tag per origin', () => {
    expect(PhotoOrigin.Shot).toBe('SHOT');
    expect(PhotoOrigin.Library).toBe('LIBRARY');
  });

  it('ownsBytes(): only a photo shot for the visit deletes its Storage object', () => {
    expect(PhotoOrigin.ownsBytes(PhotoOrigin.Shot)).toBe(true);
    expect(PhotoOrigin.ownsBytes(PhotoOrigin.Library)).toBe(false);
  });

  // Pass C (P-32): the adapter's `isShot` — which photos count for the client.
  it('countsForClient(): only a shot counts — an adopted library picture never takes a place', () => {
    expect(PhotoOrigin.countsForClient(PhotoOrigin.Shot)).toBe(true);
    expect(PhotoOrigin.countsForClient(PhotoOrigin.Library)).toBe(false);
  });

  it('is pure: same origin → same answer', () => {
    for (const origin of [PhotoOrigin.Shot, PhotoOrigin.Library]) {
      expect(PhotoOrigin.countsForClient(origin)).toBe(
        PhotoOrigin.countsForClient(origin),
      );
    }
  });
});
