import { describe, expect, it } from 'vitest';
import { ServiceVariantId } from '@core/primitives';
import { ServiceVariant } from './service-variant.data';

describe('ServiceVariant.parse', () => {
  const name = { bg: 'Къса коса', en: 'Short hair' };

  it('accepts an author-chosen slug and trims the name', () => {
    expect(
      ServiceVariant.parse({
        variantId: 'short',
        name: { bg: ' Къса коса ', en: 'Short hair' },
      }),
    ).toEqual({
      ok: true,
      value: { variantId: ServiceVariantId.of('short'), name },
    });
  });

  it('rejects a blank id and blank name fields together', () => {
    const result = ServiceVariant.parse({
      variantId: '  ',
      name: { bg: '', en: 'Short' },
    });
    expect(result).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_ID_EMPTY', idType: 'ServiceVariantId' },
        { errorCode: 'CATALOG_LOCALIZED_TEXT_FIELD_EMPTY', locale: 'bg' },
      ],
    });
  });

  it('reports a blank id alone when the name is fine', () => {
    expect(ServiceVariant.parse({ variantId: '', name })).toEqual({
      ok: false,
      error: [{ errorCode: 'CATALOG_ID_EMPTY', idType: 'ServiceVariantId' }],
    });
  });
});

describe('ServiceVariant.parseAll', () => {
  const short = { variantId: 'short', name: { bg: 'Къса', en: 'Short' } };
  const long = { variantId: 'long', name: { bg: 'Дълга', en: 'Long' } };

  it('keeps declaration order', () => {
    const result = ServiceVariant.parseAll([short, long]);
    expect(result.ok && result.value.map((v) => v.variantId)).toEqual([
      'short',
      'long',
    ]);
  });

  it('accepts no variants — no variant step when booking', () => {
    expect(ServiceVariant.parseAll([])).toEqual({ ok: true, value: [] });
  });

  it('rejects a duplicate variant declaration', () => {
    expect(ServiceVariant.parseAll([short, long, short])).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_SERVICE_DUPLICATE_VARIANT', variantId: 'short' },
      ],
    });
  });

  it('reports each variant’s own violations beside the duplicates', () => {
    const result = ServiceVariant.parseAll([
      { variantId: 'x', name: { bg: 'X', en: '' } },
      { variantId: 'x', name: { bg: 'X', en: 'X' } },
    ]);
    expect(result.ok === false && result.error.map((e) => e.errorCode)).toEqual(
      [
        'CATALOG_LOCALIZED_TEXT_FIELD_EMPTY',
        'CATALOG_SERVICE_DUPLICATE_VARIANT',
      ],
    );
  });
});
