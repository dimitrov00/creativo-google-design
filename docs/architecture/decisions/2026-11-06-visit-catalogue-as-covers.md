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
   moving the picks to another person; «Добави клиент» pushes the client
   search (see 7). A long name gives way with an
   ellipsis so the row stays one line beside «Добави». The «За …» line under
   the title is gone: the selected chip says it.

5. **The card names WHAT, the field says WHERE** (owner: "why the minutes
   and the price here, not just the service and the variant? … the
   placeholder the same as the search's … the confirm the same way as in
   the search"). A card's meta is the variant alone, as the search's; the
   ladder's row says how long and how much. The field reads «Търси в
   „Услуга“…», the search's scoped placeholder. Beside a fill the dock sits
   on its floor — the ✓ level with the field, never floating between the
   chips and it (`ui-sheet-action-bar`, and the editor's own dock rule).

6. **One order, the catalogue's** (owner: "yes, catalogue order"). The
   search listed a service where the bookings first named it; it now lists
   them as «Добави услуга» does, in the catalogue's order
   (`SearchFilterSystem.inCatalogueOrder`) — a service the catalogue no
   longer lists comes last.
7. **Another person is a dock button** (owner: "the add client button
   should be next to the apply button and the same size"): an act, not a
   person, so it leaves the chips and docks beside the ✓ at its size — the
   client page's «Нов клиент» beside its ✓.

8. **The page opens on what the person HAS** (owner: "it should have
   pre-checked the service that is already applied"). This REVERSES the
   2026-09-10 ruling that nothing is marked as already on the visit — its
   worry, that a service may be wanted twice, does not arise (below). The
   person's seats open ticked at their count (`picksOf`); each person's ticks
   are kept as the chips switch; the dock sets the services to the ticks —
   «Добави N услуги» while it only adds, «Приложи» once it also takes off
   (the newest seat of a service first), the ✓ while nothing changed.
   **A card is a TICK, never a count** (owner, same day: "the counter makes
   no sense — you cannot book the same service twice; another of the same is
   another client"): the stepper under a ticked card is gone; a second of a
   service is a second person, the dock's add-client button.
9. **The visit's own list stays ROWS** (owner: "grid in here, or keep it
   simple as rows?"). Fresha's appointment details list the booked services
   as rows — name, then duration — inside the overview; a cover grid on the
   sheet would push the client, the time and the bill a screen down for
   pictures of services the barber already knows. Covers are for CHOOSING
   (the catalogue page); rows are for READING what is booked.

## Not done

- Moving a seated service from one person to another — the ladder's «За
  кого» still does that.
