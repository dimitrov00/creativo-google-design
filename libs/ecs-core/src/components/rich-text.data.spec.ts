import { describe, expect, it } from 'vitest';
import { ProgramImageId } from '@core/primitives';
import { RichText } from './rich-text.data';

describe('RichText.imageSize', () => {
  it('reads the size a picture’s id ends in', () => {
    expect(
      RichText.imageSize(ProgramImageId.of('operation-0123_1600x900')),
    ).toEqual({ pixelWidth: 1600, pixelHeight: 900 });
  });

  it.each([
    ['pic-1'],
    ['pic_0x900'],
    ['pic_1600x'],
    ['pic_1600x900_tail'],
    ['pic_16000000x9'],
    ['1600x900'],
  ])('reads none from %s', (imageId) => {
    expect(RichText.imageSize(ProgramImageId.of(imageId))).toBeNull();
  });
});
