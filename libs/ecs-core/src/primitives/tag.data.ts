/**
 * Any `as const` tag dictionary — the dictionary of a discriminator or a
 * closed set (`BookingStatus`, `Locale`, `Weekday`, …): a plain record of
 * SCREAMING (or contract-spelled) members, no methods.
 */
type TagDictionary = Readonly<Record<string, string | number>>;

/**
 * A member of an `as const` tag dictionary — `Tag<typeof Locale>` is
 * `Locale`. The ONE membership scan behind every dictionary guard (Law 1:
 * a closed set is a dictionary declared once and compared through its
 * members), so no dictionary carries its own hand-written loop: an edge
 * reads untrusted input (a stored preference, a wire scalar, a route
 * param, a design-system option id) into the dictionary through
 * {@link Tag.has} or {@link Tag.or}, never through an `as` cast.
 */
export type Tag<D extends TagDictionary> = D[keyof D];

export const Tag = {
  /**
   * The dictionary's members in KEY order (`Object.values` order — the
   * order the dictionary declares them). A fresh array per call; a list
   * whose order is observed elsewhere stays an explicit companion member.
   */
  values<D extends TagDictionary>(d: D): readonly Tag<D>[] {
    return Object.values(d) as Tag<D>[];
  },

  /**
   * The edge guard: `raw` is one of the dictionary's members — exact match
   * (no case folding, no trimming), `false` for anything else, non-strings
   * included.
   *
   * A `for…in` scan over the dictionary's OWN keys — the members
   * `Object.values` would list, so the answers are the same — allocating
   * nothing: the read-time guards (`StoredDocumentSystem`) run it per
   * stored discriminator, per document, on every staff-day snapshot.
   */
  has<D extends TagDictionary>(d: D, raw: unknown): raw is Tag<D> {
    for (const key in d) {
      if (Object.hasOwn(d, key) && d[key] === raw) return true;
    }
    return false;
  },

  /** `raw` when it is one of the dictionary's members ({@link Tag.has}), else `fallback`. */
  or<D extends TagDictionary>(d: D, raw: unknown, fallback: Tag<D>): Tag<D> {
    return Tag.has(d, raw) ? raw : fallback;
  },
} as const;
