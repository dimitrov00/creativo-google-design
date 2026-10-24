import {
  type Firestore,
  collection,
  doc,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import {
  Collections,
  type StreakDefinition,
  type StreakDefinitionVersion,
  Subcollections,
} from '@core/entities';
import type { StreakDefinitionPorts } from '@core/ports';
import { PagingSystem } from '@core/systems';
import { observeDoc, readQuery } from './observe';

/**
 * THE RHYTHM'S RULE, read side (flip 3, plan §3.4; client-card-revision-3.md
 * §4.3) — the successor of the legacy repository's reads, WITHOUT its
 * mappers: every body answered AS STORED (Law 5, F3-1 (b)).
 *
 * The head, `streakDefinitions/{id}`, is WATCHED: any signed-in person may
 * read it, and the page that edits it sees a publish from another tab as
 * it lands; `null` while the shop has published no rule. Which of its
 * `rules` is in force on a day is `StreakRuleSystem`'s to say, never this
 * reader's. The history, `streakDefinitions/{id}/versions/*`, is read once
 * and is the admin pair's alone: for anyone else the rules refuse it,
 * which is a failed `Result`. Newest first by the body's own `version`,
 * which the document id spells padded: the order is the same, and a
 * descending read of a plain field is served by the index Firestore keeps
 * by itself, where a descending read of document ids would need one
 * declared. Every version carries its whole flat rule, so no head is read
 * beside it.
 *
 * WRITES are the server's: `firestore.rules` refuses every client write to
 * either path, the admin's included — the publish goes through the
 * callable (`streakPublishGatewayPorts`).
 */
export const streakDefinitionPorts = (
  db: Firestore,
): StreakDefinitionPorts => ({
  observeStreakDefinitionHead: (id) =>
    observeDoc<StreakDefinition>(doc(db, Collections.StreakDefinitions, id)),

  listStreakDefinitionVersions: (id, max) => {
    const path = `${Collections.StreakDefinitions}/${id}/${Subcollections.Versions}`;
    return readQuery<StreakDefinitionVersion>(
      query(
        collection(db, path),
        orderBy('version', 'desc'),
        limit(PagingSystem.pageSizeOf(max)),
      ),
      path,
    );
  },
});
