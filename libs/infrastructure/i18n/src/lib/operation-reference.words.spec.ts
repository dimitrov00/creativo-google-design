import { describe, expect, it } from 'vitest';
import { ClientOperationId } from '@core/primitives';
import bg from '../assets/i18n/bg.json';
import en from '../assets/i18n/en.json';
import { operationReferenceWords } from './operation-reference.words';

/*
 * THE REFERENCE LINE (WS-4.5, DEP-20): a failed call's operation id worded
 * under the surface's own error sentence — pinned byte for byte in bg and
 * en off the real catalogues, and no line at all without an id.
 */

/** A catalogue as `transloco.translate`: the key's copy, `{{name}}` filled; the key itself else. */
function translateOf(catalogue: unknown) {
  return (key: string, params: Readonly<Record<string, unknown>>): string => {
    let node: unknown = catalogue;
    for (const segment of key.split('.')) {
      node =
        node !== null && typeof node === 'object'
          ? Object.getOwnPropertyDescriptor(node, segment)?.value
          : undefined;
    }
    if (typeof node !== 'string') return key;
    return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(Object.getOwnPropertyDescriptor(params, name)?.value ?? ''),
    );
  };
}

const ID = ClientOperationId.parse('op-7f3a9c2e5b1d4a60');
if (!ID.ok) throw new Error('fixture failed its smart constructor');

describe('operationReferenceWords', () => {
  it('words the reference line and its copy confirmation in bg', () => {
    expect(operationReferenceWords(ID.value, translateOf(bg))).toEqual({
      text: 'Код за справка: op-7f3a9c2e5b1d4a60',
      copiedText: 'Кодът е копиран.',
    });
  });

  it('words the reference line and its copy confirmation in en', () => {
    expect(operationReferenceWords(ID.value, translateOf(en))).toEqual({
      text: 'Reference: op-7f3a9c2e5b1d4a60',
      copiedText: 'Reference copied.',
    });
  });

  it('prints no line for a failure without an id — and asks the catalogue nothing', () => {
    const asked: string[] = [];
    const translate = (key: string): string => {
      asked.push(key);
      return key;
    };

    expect(operationReferenceWords(null, translate)).toBeNull();
    expect(asked).toEqual([]);
  });

  it('asks for the operation namespace’s keys, the id as `ref`', () => {
    const asked: [string, Readonly<Record<string, unknown>>][] = [];
    const translate = (
      key: string,
      params: Readonly<Record<string, unknown>>,
    ): string => {
      asked.push([key, params]);
      return key;
    };

    operationReferenceWords(ID.value, translate);

    expect(asked).toEqual([
      ['operation.reference', { ref: 'op-7f3a9c2e5b1d4a60' }],
      ['operation.referenceCopied', {}],
    ]);
  });

  it('is pure — the same id, the same words', () => {
    const translate = translateOf(en);
    expect(operationReferenceWords(ID.value, translate)).toEqual(
      operationReferenceWords(ID.value, translate),
    );
  });
});
