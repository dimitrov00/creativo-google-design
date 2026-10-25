import { Result } from '@core/primitives';
import {
  UiIconAsset,
  type UiIconArtwork,
  type UiIconEntry,
  type UiVectorAsset,
} from '../manifest/icon-manifest';

/**
 * Pure resolution: layered key lookup with bounded, cycle-checked aliases.
 *
 * Layers are ordered most-specific first — DI overrides, then the remote
 * manifest, then the bundled vocabulary. Every hop of an alias restarts the
 * lookup at the TOP layer, so an override for the target of a bundled alias
 * is honoured, and a remote manifest may alias a key onto one it also
 * overrides. The framework-free shape is what makes the tests table-driven.
 */

/**
 * Where an icon (or the manifest the registry wears) came from. Values:
 * external contract — the `(origin)` segment `consoleUiIconReporter` prints,
 * and the `layer` a resolution reports; spelled as they always were.
 */
export const UiIconOrigin = {
  /** DI overrides (`provideUiIcons`) — code someone wrote for a scope. */
  Override: 'override',
  /** The live remote manifest. */
  Remote: 'remote',
  /** The last remote manifest that passed validation, read at startup. */
  Cached: 'cached',
  /** The bundled vocabulary (`icon-vocabulary.ts`). */
  Bundled: 'bundled',
  /** The manifest source itself (its stream or its cache failed). */
  Source: 'source',
} as const;
export type UiIconOrigin = (typeof UiIconOrigin)[keyof typeof UiIconOrigin];

/** The three layers a lookup walks, most specific first. */
export type UiIconLayerName =
  | typeof UiIconOrigin.Override
  | typeof UiIconOrigin.Remote
  | typeof UiIconOrigin.Bundled;

export interface UiIconLayer {
  readonly name: UiIconLayerName;
  readonly icons: Readonly<Record<string, UiIconEntry | undefined>>;
}

/**
 * Why a key resolved to nothing — the failure's `reason`. Values: external
 * contract — the diagnostic codes `consoleUiIconReporter` prints, kebab as
 * they were (OQ-11).
 */
export const UiIconFailureReason = {
  /** No layer has an entry for the key. */
  IconMissing: 'icon-missing',
  /** An alias hop landed on a key no layer has. */
  AliasDangling: 'alias-dangling',
  /** An alias chain came back to a key it already walked. */
  AliasCycle: 'alias-cycle',
  /** An alias chain longer than {@link UI_ICON_ALIAS_DEPTH}. */
  AliasDepth: 'alias-depth',
  /** The entry names artwork that cannot render (a Material glyph off the table). */
  GlyphMissing: 'glyph-missing',
} as const;
export type UiIconFailureReason =
  (typeof UiIconFailureReason)[keyof typeof UiIconFailureReason];

export interface UiIconResolved {
  readonly key: string;
  readonly asset: UiVectorAsset;
  /** The layer that supplied the final asset. */
  readonly layer: UiIconLayerName;
  /** The keys walked, first to last — `[key]` when no alias was involved. */
  readonly via: readonly string[];
}

export interface UiIconFailure {
  readonly key: string;
  readonly reason: UiIconFailureReason;
  readonly via: readonly string[];
  readonly detail: string;
}

/** The artwork with the walk that found it, or why there is none — a `Result`, never a thrown error. */
export type UiIconResolution = Result<UiIconResolved, UiIconFailure>;

/** Longer chains are a defect, not a use case. */
export const UI_ICON_ALIAS_DEPTH = 8;

export function resolveIconEntry(
  layers: readonly UiIconLayer[],
  key: string,
  toVector: (asset: UiIconArtwork) => UiVectorAsset | null,
): UiIconResolution {
  const via: string[] = [key];
  const visited = new Set<string>([key]);
  let current = key;

  for (;;) {
    let found: { entry: UiIconEntry; layer: UiIconLayerName } | null = null;
    for (const layer of layers) {
      const entry = layer.icons[current];
      if (entry !== undefined) {
        found = { entry, layer: layer.name };
        break;
      }
    }

    if (!found) {
      return Result.err(
        via.length === 1
          ? {
              key,
              reason: UiIconFailureReason.IconMissing,
              via,
              detail: `no entry for "${key}"`,
            }
          : {
              key,
              reason: UiIconFailureReason.AliasDangling,
              via,
              detail: `alias target "${current}" has no entry`,
            },
      );
    }

    if ('alias' in found.entry) {
      const next = found.entry.alias;
      if (visited.has(next)) {
        return Result.err({
          key,
          reason: UiIconFailureReason.AliasCycle,
          via: [...via, next],
          detail: `alias cycle: ${[...via, next].join(' → ')}`,
        });
      }
      if (via.length >= UI_ICON_ALIAS_DEPTH) {
        return Result.err({
          key,
          reason: UiIconFailureReason.AliasDepth,
          via,
          detail: `alias chain longer than ${UI_ICON_ALIAS_DEPTH}`,
        });
      }
      visited.add(next);
      via.push(next);
      current = next;
      continue;
    }

    const asset = toVector(found.entry);
    if (!asset) {
      return Result.err({
        key,
        reason: UiIconFailureReason.GlyphMissing,
        via,
        detail:
          found.entry.iconAsset === UiIconAsset.Material
            ? `material glyph "${found.entry.glyph}" is not in the bundled table`
            : 'asset could not be rendered',
      });
    }
    return Result.ok({ key, asset, layer: found.layer, via });
  }
}
