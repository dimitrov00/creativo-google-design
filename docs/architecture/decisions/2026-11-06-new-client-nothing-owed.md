# «Нов клиент» owes nothing — ruling (2026-11-06)

> **Status: RULED and BUILT (2026-11-06).** The owner, on the visit sheet's
> new-client page: "there might be walk-ins, or a person with a phone and/or
> an email — right now it is not clear that name and/or phone and/or email
> are optional". Rubric of `2026-10-26-owner-rulings.md`: **C** correctness ·
> **T** one source of truth · **U** UX · **M** simplicity · **R** reversibility.

## References (Mobbin, iOS)

- **Co–Star** — the one optional field says «Optional» at the trailing end
  of its label, with a line under it saying what leaving it out costs.
- **Urban Company**, **Ubank** — a lede under the title says what the
  contact is FOR before the fields ask for it.
- **GoHenry** — «They don't have an email» as an explicit way out.

## Ruling

1. **Every field is optional** (U, C). The ✓ seats whoever is in the chair:
   a name, a number, a mail, any of them or none. A mail, once typed, must be
   one (OR-26 — what was typed never vanishes on the way to the record).
2. **Every label says it, where the eye is** (U). Each label wears
   «по желание» at its trailing end in secondary ink (Co–Star), and the
   phone field takes it as `labelNote` (`ui-phone-field`), read with the
   label. A first build said it ONCE in a subtitle under the title; the
   owner: "no one reads the subtitle" — the label is what a barber reads
   while typing, so the mark goes there and the subtitle went.
3. **The blank says what it becomes** (U, T). The name field's placeholder
   is the name a nameless person is seated under — «Случаен клиент», then
   «Случаен клиент 2» past the visit's own people — the save's own walk-in
   numbering (`VisitDraftSystem.walkInLabels`, `walkInFallbackOf`), so the
   placeholder and the record never disagree.

## Not done

- No «Случаен клиент» shortcut on the search page itself: the empty form's
  ✓ is one tap from the dock's ＋ already.
- An email placeholder: no email field in the app shows an example.
