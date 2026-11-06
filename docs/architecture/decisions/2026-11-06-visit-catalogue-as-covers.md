# The visit sheet's «Добави услуга» as the search's catalogue — ruling (2026-11-06)

> **Status: RULED and BUILT (2026-11-06).** The owner asked for the visit
> sheet's service page to "look the same way as in the search services", the
> search "positioned the same way as in the search", and the visit's clients
> "visible in the toolbar so you can add more clients or change whose
> booking".

## Ruling

1. **Cover cards, the search sheet's** (T). Each service is a
   `cr-service-card` — the cover, the service's name under it, its variant,
   minutes and price beneath — three across; services without variants flow
   together and a service with variants stands in a grid of its own
   (`coverRowsOf`, now ONE helper for the search and the visit sheet). The
   covers ride on the options (`VisitEditorServiceOption.coverSrc`).
2. **A tap picks, a stepper counts** (U). A tap picks a card (its ring turns
   to the accent ✓) or takes the pick off; a picked card unfolds the DS
   count stepper under its caption, so a second of the same is one press —
   the parity the row's trailing stepper had (a service may be wanted twice,
   2026-09-10).
3. **The search at the thumb** (U, T). The field leaves the page's head and
   fills the sheet's dock beside «Добави N услуги» / ✓ — the search sheet's
   place. `ui-sheet-action-bar` gains the page bar's `uiFill` slot, the
   contract the two bars already claimed to share.
4. **The visit's people over the field** (U). Photos' chips over the search:
   one chip per person on the visit, the one the picks seat for selected in
   the accent (the page's subject, else the first — `servicePeopleVm`), a tap
   moving the picks to another person; a glyph chip («Добави клиент», named
   for the ear) pushes the client search. A long name gives way with an
   ellipsis so the row stays one line beside «Добави». The «За …» line under
   the title is gone: the selected chip says it.

## Not done

- Moving a seated service from one person to another — the ladder's «За
  кого» still does that.
