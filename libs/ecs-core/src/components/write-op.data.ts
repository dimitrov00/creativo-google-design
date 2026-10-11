/**
 * One entry of a write plan. A system that would "write" returns
 * `readonly WriteOp[]` and the pipeline's single commit port applies it
 * (Law 4) — so a decision is data a spec can assert, and `set`/`create`/
 * `update`/`delete` exist only inside the adapter that applies the plan.
 *
 * A component, not a port type: systems return it, and a system may import
 * a `.data` module but never a `.port` one.
 *
 * **Root fields only (Laws 5 and 6).** An `Update` names ROOT fields of the
 * flat document — never a dot path — and `deleteFields` names root fields to
 * remove (`FieldValue.delete()`), so a variant transition leaves the stored
 * document equal to exactly one variant: {@link WriteOp.transition} sets
 * every field of the new variant and deletes every field of the old one the
 * new one does not declare ({@link WriteOp.variantFieldsToDelete}).
 */

/** Write tags — the ONLY source of these strings; the field is `writeAction`. */
export const WriteAction = {
  Set: 'SET',
  Create: 'CREATE',
  Update: 'UPDATE',
  Delete: 'DELETE',
} as const;
export type WriteAction = (typeof WriteAction)[keyof typeof WriteAction];

/**
 * A document path as alternating collection names and ids —
 * `['clientStats', uid, 'restricted', 'money']` is one path. Collection
 * names come from the collection registry, never a literal at the call site.
 */
export type DocPath = readonly string[];

/**
 * A document body (or an update's field map): the flat entity minus `id`.
 * Entity types are object type aliases, so any of them is assignable here
 * without a cast.
 */
export type DocBody = { readonly [field: string]: unknown };

export type WriteOp =
  WriteOp.Set | WriteOp.Create | WriteOp.Update | WriteOp.Delete;

const NO_DELETES: readonly string[] = [];

export const WriteOp = {
  /** Replace the whole document (create it when absent). Never carries a deletion. */
  set(path: DocPath, body: DocBody): WriteOp.Set {
    return { writeAction: WriteAction.Set, path, body };
  },

  /** Create the document; the commit answers `REPOSITORY_ALREADY_EXISTS` when it is there. */
  create(path: DocPath, body: DocBody): WriteOp.Create {
    return {
      writeAction: WriteAction.Create,
      path,
      body,
    };
  },

  /** Merge ROOT `fields` into an existing document (Law 5: never dot paths); deletes nothing. */
  update(path: DocPath, fields: DocBody): WriteOp.Update {
    return {
      writeAction: WriteAction.Update,
      path,
      fields,
      deleteFields: NO_DELETES,
    };
  },

  /**
   * A variant transition: set every root field of the new variant (`fields`)
   * and remove (`FieldValue.delete()`) every root field of the old variant the
   * new one does not declare (`deleteFields` — build it with
   * {@link variantFieldsToDelete}, never by hand). Data, no validation: a key
   * in BOTH lists is refused by every adapter and double at commit time
   * (`REPOSITORY_WRITE_FAILED`, reason `field-set-and-deleted`).
   */
  transition(
    path: DocPath,
    fields: DocBody,
    deleteFields: readonly string[],
  ): WriteOp.Update {
    return {
      writeAction: WriteAction.Update,
      path,
      fields,
      deleteFields,
    };
  },

  /**
   * Delete the document — how a plan removes what emptied (a busy day with
   * no blocks left, a barber's capacity entry). `delete` is a keyword, so the
   * factory is `remove`; the tag stays `WriteAction.Delete`.
   */
  remove(path: DocPath): WriteOp.Delete {
    return { writeAction: WriteAction.Delete, path };
  },

  isDelete(op: WriteOp): op is WriteOp.Delete {
    return op.writeAction === WriteAction.Delete;
  },

  /**
   * The root keys present in `before` and absent from `after` — the fields a
   * transition from the flat variant `before` to the flat variant `after`
   * must delete so the stored document is exactly one variant. Key order of
   * `before`; a key whose value is `null` in `after` is present (kept).
   */
  variantFieldsToDelete(before: DocBody, after: DocBody): readonly string[] {
    const stale: string[] = [];
    const keys = Object.keys(before);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] as string;
      if (!Object.prototype.hasOwnProperty.call(after, key)) stale.push(key);
    }
    return stale;
  },
} as const;

export namespace WriteOp {
  export type Set = {
    readonly writeAction: typeof WriteAction.Set;
    readonly path: DocPath;
    readonly body: DocBody;
  };
  export type Create = {
    readonly writeAction: typeof WriteAction.Create;
    readonly path: DocPath;
    readonly body: DocBody;
  };
  /** Root fields only. `deleteFields` names root fields to remove (FieldValue.delete()). */
  export type Update = {
    readonly writeAction: typeof WriteAction.Update;
    readonly path: DocPath;
    readonly fields: DocBody;
    readonly deleteFields: readonly string[];
  };
  export type Delete = {
    readonly writeAction: typeof WriteAction.Delete;
    readonly path: DocPath;
  };
}
