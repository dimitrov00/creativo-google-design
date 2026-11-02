import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { queryNeedsLimit } from './query-needs-limit.mjs';

const tester = new RuleTester({
  languageOptions: { parser: tsParser },
});

tester.run('creativo/query-needs-limit', queryNeedsLimit, {
  valid: [
    // A QuerySpec with a number, or a reason.
    "const q = { collection: ['a'], where: [], orderBy: [], limit: 20 };",
    `const q = {
      collection: ['a'],
      where: [],
      orderBy: [],
      // unbounded-ok: one barber's day holds a handful of visits
      limit: null,
    };`,
    `// unbounded-ok: one barber's day holds a handful of visits
    const q = { collection: ['a'], where: [], orderBy: [], limit: null };`,
    // Another object's `limit: null` is no query.
    'const page = { limit: null };',
    // Modular, with a limit.
    "query(ref, where('a', '==', 1), limit(5));",
    "query(ref, orderBy('a'), limitToLast(5));",
    // A batch by id is capped by Firestore.
    "query(ref, where(documentId(), 'in', ids));",
    `// unbounded-ok: a shop has few services
    query(ref, where('a', '==', 1));`,
    `const snap = await getDocs(
      // unbounded-ok: a shop has few services
      query(ref, where('a', '==', 1)),
    );`,
    // Admin, with a limit.
    "db.collection('a').where('b', '==', 1).limit(5).get();",
    "db.collection('a').where(FieldPath.documentId(), 'in', ids).get();",
    // One document, or nothing the rule can see.
    "db.collection('a').doc(id).get();",
    "db.doc('a/b').get();",
    'map.get(key);',
    'ref.get();',
    `// unbounded-ok: the walk is paged by the caller
    db.collection('a').where('b', '==', 1).get();`,
  ],
  invalid: [
    {
      code: "const q = { collection: ['a'], where: [], orderBy: [], limit: null };",
      errors: [{ messageId: 'specNull' }],
    },
    {
      code: "query(ref, where('a', '==', 1));",
      errors: [{ messageId: 'modular' }],
    },
    {
      // A spread could hold a limit; the rule cannot see into it.
      code: 'query(ref, ...constraints);',
      errors: [{ messageId: 'modular' }],
    },
    {
      // An id batch needs `in`.
      code: "query(ref, where(documentId(), '==', id));",
      errors: [{ messageId: 'modular' }],
    },
    {
      // A comment with no reason is no waiver.
      code: `// unbounded-ok:
      query(ref, where('a', '==', 1));`,
      errors: [{ messageId: 'modular' }],
    },
    {
      // A comment two lines up says nothing about this one.
      code: `// unbounded-ok: elsewhere

      query(ref, where('a', '==', 1));`,
      errors: [{ messageId: 'modular' }],
    },
    {
      code: "db.collection('a').where('b', '==', 1).get();",
      errors: [{ messageId: 'admin' }],
    },
    {
      code: "db.collection('a').get();",
      errors: [{ messageId: 'admin' }],
    },
    {
      code: "db.collection('a').orderBy('b').stream();",
      errors: [{ messageId: 'admin' }],
    },
  ],
});
