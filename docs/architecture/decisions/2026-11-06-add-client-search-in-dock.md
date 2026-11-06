# «Добави клиент»: the search at the thumb, a person in one glance — ruling (2026-11-06)

> **Status: RULED and BUILT (2026-11-06).** The owner, on the visit sheet's
> add-client page: "establish the same UI/UX style so the vocabulary and the
> look remain the same — the search moves to the bottom toolbar … open to a
> full redesign; pull from Mobbin how customer rows look; the user
> experience must be super good". Rubric of `2026-10-26-owner-rulings.md`:
> **C** correctness · **T** one source of truth · **U** UX · **M** simplicity
> · **R** reversibility.

## References (Mobbin, iOS)

- **Google Calendar «Add guests»** — the search field at the bottom, the ✓
  in reach, the people above it.
- **Revolut Business, Granola, Luma, Outlook, PayPal** — a customer row is
  a face, the name, and ONE secondary line (the number or the mail).
- **Apple Invites, Snapchat** — the picked ticked in the list; a «New»
  row of the people's own anatomy.

## Ruling

1. **The search is the dock's** (U, T). The field fills the bottom bar,
   «Нов клиент» (＋) hugs the ✓ at its size — the service page's dock,
   field for field, and the search sheet's thumb-reach field. Its
   placeholder is the search sheet's own scoped wording, «Търси в
   „Клиент“…» (`staff.search.key.client`), its accessible label «Име,
   телефон или имейл»; the glyph still says what the typing was read as.
   The title folds while the field is engaged, as on the service page.
2. **No count in the dock** (M). «Избрани N» repeated what «На
   посещението» shows on the page, and the field needs the room.
3. **A person in one glance** (U). The row is the face, the name and ONE
   contact on its own glyph-led line — the one the typing matched, else the
   number, else the mail (`clientRowVm`) — with the last visit quiet at the
   trailing edge, the search sheet's `detail`; the ✓ takes that place once
   picked, «Вече е клиент» once the typed number or mail is theirs. The
   2026-09-22 rule stands: a fact on a line of its own, never dot-joined;
   «Без профил» stays the walk-in's last line (OR-26). Measured on a 370 pt
   sheet at rest: seven people on screen, where the three-line rows showed
   four.

## Not done

- Picked people as chips over the field (the service page's accessory):
  the 2026-09-22 ruling retired chips here for «На посещението», and one
  person keeps one place.
