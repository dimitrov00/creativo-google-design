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

  it('parse(): library only when named, anything else is a shot (the reader fallback)', () => {
    expect(PhotoOrigin.parse('LIBRARY')).toBe(PhotoOrigin.Library);
    // The stored legacy spelling, until the photo flip.
    expect(PhotoOrigin.parse('library')).toBe(PhotoOrigin.Library);
    expect(PhotoOrigin.parse('SHOT')).toBe(PhotoOrigin.Shot);
    expect(PhotoOrigin.parse('shot')).toBe(PhotoOrigin.Shot);
    expect(PhotoOrigin.parse(undefined)).toBe(PhotoOrigin.Shot);
    expect(PhotoOrigin.parse('Library')).toBe(PhotoOrigin.Shot);
    expect(PhotoOrigin.parse(42)).toBe(PhotoOrigin.Shot);
  });
});
