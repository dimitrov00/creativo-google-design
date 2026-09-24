import type {
  UiIconAsset,
  UiIconEntry,
  UiVectorAsset,
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
export type UiIconLayerName = 'override' | 'remote' | 'bundled';

export interface UiIconLayer {
  readonly name: UiIconLayerName;
  readonly icons: Readonly<Record<string, UiIconEntry | undefined>>;
}

export type UiIconFailureReason =
  | 'icon-missing'
  | 'alias-dangling'
  | 'alias-cycle'
  | 'alias-depth'
  | 'glyph-missing';

export interface UiIconResolved {
  readonly ok: true;
  readonly key: string;
  readonly asset: UiVectorAsset;
  /** The layer that supplied the final asset. */
  readonly layer: UiIconLayerName;
  /** The keys walked, first to last — `[key]` when no alias was involved. */
  readonly via: readonly string[];
}

export interface UiIconFailure {
  readonly ok: false;
  readonly key: string;
  readonly reason: UiIconFailureReason;
  readonly via: readonly string[];
  readonly detail: string;
}

export type UiIconResolution = UiIconResolved | UiIconFailure;

/** Longer chains are a defect, not a use case. */
export const UI_ICON_ALIAS_DEPTH = 8;

export function resolveIconEntry(
  layers: readonly UiIconLayer[],
  key: string,
  toVector: (asset: UiIconAsset) => UiVectorAsset | null,
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
      return via.length === 1
        ? {
            ok: false,
            key,
            reason: 'icon-missing',
            via,
            detail: `no entry for "${key}"`,
          }
        : {
            ok: false,
            key,
            reason: 'alias-dangling',
            via,
            detail: `alias target "${current}" has no entry`,
          };
    }

    if ('alias' in found.entry) {
      const next = found.entry.alias;
      if (visited.has(next)) {
        return {
          ok: false,
          key,
          reason: 'alias-cycle',
          via: [...via, next],
          detail: `alias cycle: ${[...via, next].join(' → ')}`,
        };
      }
      if (via.length >= UI_ICON_ALIAS_DEPTH) {
        return {
          ok: false,
          key,
          reason: 'alias-depth',
          via,
          detail: `alias chain longer than ${UI_ICON_ALIAS_DEPTH}`,
        };
      }
      visited.add(next);
      via.push(next);
      current = next;
      continue;
    }

    const asset = toVector(found.entry);
    if (!asset) {
      return {
        ok: false,
        key,
        reason: 'glyph-missing',
        via,
        detail:
          found.entry.kind === 'material'
            ? `material glyph "${found.entry.glyph}" is not in the bundled table`
            : 'asset could not be rendered',
      };
    }
    return { ok: true, key, asset, layer: found.layer, via };
  }
}
