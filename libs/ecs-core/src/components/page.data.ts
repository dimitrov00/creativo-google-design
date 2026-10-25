import type { PageKey } from './page-key.data';

/** A finished page: its rows, newest first, and where the next one resumes (`null`: nothing older). */
export type Page<R, K extends PageKey> = {
  readonly rows: readonly R[];
  readonly cursor: K | null;
};
