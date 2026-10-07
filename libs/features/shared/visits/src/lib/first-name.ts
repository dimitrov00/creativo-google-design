/**
 * «Иван» from «Иван Колев» — what a line carries once the whole name would
 * truncate: a staff schedule's column head (2026-09-23, the grid views'
 * design record §4) and a visit row's fact line (client-card redesign,
 * wave D: the barber is the fact that varies least, so it goes last and
 * short). Half a surname identifies nobody; a first name in a shop of five
 * does. The accessible name keeps the whole one.
 */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
