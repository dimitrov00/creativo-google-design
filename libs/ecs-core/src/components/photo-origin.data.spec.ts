import { describe, expect, it } from 'vitest';
import { PhotoOrigin } from './photo-origin.data';

describe('PhotoOrigin', () => {
  it('keeps the stored origin strings', () => {
    expect(PhotoOrigin.Shot).toBe('shot');
    expect(PhotoOrigin.Library).toBe('library');
  });

  it('ownsBytes(): only a photo shot for the visit deletes its Storage object', () => {
    expect(PhotoOrigin.ownsBytes(PhotoOrigin.Shot)).toBe(true);
    expect(PhotoOrigin.ownsBytes(PhotoOrigin.Library)).toBe(false);
  });

  it('parse(): library only when named, anything else is a shot (the reader fallback)', () => {
    expect(PhotoOrigin.parse('library')).toBe(PhotoOrigin.Library);
    expect(PhotoOrigin.parse('shot')).toBe(PhotoOrigin.Shot);
    expect(PhotoOrigin.parse(undefined)).toBe(PhotoOrigin.Shot);
    expect(PhotoOrigin.parse('LIBRARY')).toBe(PhotoOrigin.Shot);
    expect(PhotoOrigin.parse(42)).toBe(PhotoOrigin.Shot);
  });
});
