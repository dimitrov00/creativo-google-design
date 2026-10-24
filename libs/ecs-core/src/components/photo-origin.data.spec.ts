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
});
