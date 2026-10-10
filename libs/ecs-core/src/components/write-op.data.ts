/**
 * One entry of a write plan. A system that would "write" returns
 * `readonly WriteOp[]` and the pipeline's single commit port applies it
 * (Law 4) — so a decision is data a spec can assert, and `set`/`create`/
 * `update`/`delete` exist only inside the adapter that applies the plan.
 *
 * A component, not a port type: systems return it, and a system may import
 * a `.data` module but never a `.port` one.
 */

/** Write tags — the ONLY source of these strings. */
export const WriteKind = {
  Set: 'set',
  Create: 'create',
  Update: 'update',
  Delete: 'delete',
} as const;
export type WriteKind = (typeof WriteKind)[keyof typeof WriteKind];

/**
 * A document path as alternating collection names and ids —
 * `['clientStats', uid, 'restricted', 'money']` is one path. Collection
 * names come from the collection registry, never a literal at the call site.
 */
export type DocPath = readonly string[];

/**
 * A document body (or an update's field map): the entity's component bag
 * minus `id`. Entity types are object type aliases, so any of them is
 * assignable here without a cast.
 */
export type DocBody = { readonly [field: string]: unknown };

export type WriteOp =
  WriteOp.Set | WriteOp.Create | WriteOp.Update | WriteOp.Delete;

export const WriteOp = {
  /** Replace the whole document (create it when absent). */
  set(path: DocPath, body: DocBody): WriteOp.Set {
    return { kind: WriteKind.Set, path, body };
  },

  /** Create the document; the commit fails when it already exists. */
  create(path: DocPath, body: DocBody): WriteOp.Create {
    return { kind: WriteKind.Create, path, body };
  },

  /** Merge root `fields` into an existing document (Law 5: never dot paths). */
  update(path: DocPath, fields: DocBody): WriteOp.Update {
    return { kind: WriteKind.Update, path, fields };
  },

  /**
   * Delete the document — how a plan removes what emptied (a busy day with
   * no blocks left, a barber's capacity entry). `delete` is a keyword, so the
   * factory is `remove`; the tag stays `WriteKind.Delete`.
   */
  remove(path: DocPath): WriteOp.Delete {
    return { kind: WriteKind.Delete, path };
  },

  isDelete(op: WriteOp): op is WriteOp.Delete {
    return op.kind === WriteKind.Delete;
  },
} as const;

export namespace WriteOp {
  export type Set = {
    readonly kind: typeof WriteKind.Set;
    readonly path: DocPath;
    readonly body: DocBody;
  };
  export type Create = {
    readonly kind: typeof WriteKind.Create;
    readonly path: DocPath;
    readonly body: DocBody;
  };
  export type Update = {
    readonly kind: typeof WriteKind.Update;
    readonly path: DocPath;
    readonly fields: DocBody;
  };
  export type Delete = {
    readonly kind: typeof WriteKind.Delete;
    readonly path: DocPath;
  };
}
