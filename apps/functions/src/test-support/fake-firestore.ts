/**
 * Minimal in-memory double for the slice of the Admin Firestore SDK this
 * app's repositories actually use (collection/doc/add/get/set/update, plus
 * where(==)/where(>=)/limit chains) — enough to unit-test repository and
 * use-case logic without an emulator or the real `firebase-admin` package.
 */
type Doc = Record<string, unknown>;

interface FakeSnapshot {
  readonly id: string;
  readonly exists: boolean;
  data(): Doc | undefined;
}

interface FakeQuerySnapshot {
  readonly empty: boolean;
  readonly docs: FakeSnapshot[];
}

type Filter = (doc: Doc) => boolean;

export function createFakeFirestore() {
  const collections = new Map<string, Map<string, Doc>>();
  let counter = 0;

  function collectionMap(name: string): Map<string, Doc> {
    let col = collections.get(name);
    if (!col) {
      col = new Map();
      collections.set(name, col);
    }
    return col;
  }

  function query(name: string, filters: Filter[]) {
    return {
      where(field: string, op: '==' | '>=', value: unknown) {
        const filter: Filter = (doc) => {
          // eslint-disable-next-line security/detect-object-injection -- test-only in-memory double; `field` always originates from this repo's own repository code, never external input.
          const actual = doc[field];
          if (op === '==') return actual === value;
          if (op === '>=') return (actual as string) >= (value as string);
          throw new Error(`unsupported operator ${op}`);
        };
        return query(name, [...filters, filter]);
      },
      limit(n: number) {
        return {
          async get(): Promise<FakeQuerySnapshot> {
            const docs = matching().slice(0, n);
            return { empty: docs.length === 0, docs };
          },
        };
      },
      async get(): Promise<FakeQuerySnapshot> {
        const docs = matching();
        return { empty: docs.length === 0, docs };
      },
    };

    function matching(): FakeSnapshot[] {
      return [...collectionMap(name).entries()]
        .filter(([, data]) => filters.every((f) => f(data)))
        .map(([id, data]) => ({ id, exists: true, data: () => data }));
    }
  }

  return {
    collection(name: string) {
      return {
        ...query(name, []),
        doc(id?: string) {
          const docId = id ?? `doc_${counter++}`;
          return {
            async get(): Promise<FakeSnapshot> {
              const data = collectionMap(name).get(docId);
              return {
                id: docId,
                exists: data !== undefined,
                data: () => data,
              };
            },
            async set(data: Doc): Promise<void> {
              collectionMap(name).set(docId, data);
            },
            async update(patch: Doc): Promise<void> {
              const existing = collectionMap(name).get(docId) ?? {};
              collectionMap(name).set(docId, { ...existing, ...patch });
            },
          };
        },
        async add(data: Doc): Promise<{ id: string }> {
          const docId = `doc_${counter++}`;
          collectionMap(name).set(docId, data);
          return { id: docId };
        },
      };
    },
  };
}
