/**
 * One named i18n parameter of a row's label — non-personal, never a note
 * or a name. Declared change (§3.2): today's open `params` map
 * (`Record<string, string | number>`, a dynamic field path per key across
 * the collection) is an array of these.
 */
export type LabelParam = {
  readonly name: string;
  readonly value: string | number;
};
