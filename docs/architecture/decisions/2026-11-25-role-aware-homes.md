# Role-aware homes: where each person lands (2026-11-25)

> **Status: RULED by the owner on 2026-11-25 (questions 1–4 and 6 of the
> role-aware homes brief), being built.** The brief came out of a
> brainstorm on what each role should see once signed in, reviewed by six
> Goldfish lenses on 2026-11-24. Questions 5 and 7–11 stay open and are
> asked when the step that needs them is built.

## The problem

The app has one home for everyone, `/account`, the client's page. A shop's
owner who also cuts hair is the common account, and they work from the
schedule. Before this:

- The installed app's `/` sent every signed-in person to `/account`.
- After sign-in with no link to follow, everyone landed on `/account`.
- The header's «Вход» pill and the footer's login link sent
  `?redirect=/account`, so even a rule that read the roles would never have
  run on the most common sign-in.

So a barber needed two taps to reach the day on every launch. On top of
that, rebooking (the brief's other goal) depends on visits being marked
done, which the shop never does: the owner ruled earlier that every stamp
is optional.

## Decisions

| #   | Question                                      | Ruling                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | How does a past visit become done?            | A nightly job marks past visits nobody touched as done, the way Fresha auto-completes. A no-show can still be marked afterwards. A forgotten no-show counts as worked until someone corrects it. Built with the rebooking step.                                        |
| 2   | What is the owner's «Салон» view in v1?       | No new route and no tab bar. The schedule's chart button is the way in: it carries its word from 600 px of bar, a badge counts the pending decisions, and «Анализи» opens with them on top. Built in PR #135.                                                          |
| 3   | Where do the unusual role sets land?          | An admin with no chair, the sysadmin, a barber role with no linked record and a content manager who is also the front desk all land on the schedule, on every chair. A link the person remembered and can no longer open lands them on their home, never `/forbidden`. |
| 4   | How does the landing know the person's chair? | It reads the account document (`linkedBarberId`) from the device's cache and puts the chair in the link (`?barber=`). The first launch waits for that one read; later launches answer from the device. No new claim in the sign-in token.                              |
| 6   | May `/account` name the cut and the barber?   | Yes. The client home's cards name the services and the barber. The three catalogue reads are the queries the site menu already holds open on every page with the header, so this opens no new listener. Built in step 4.                                               |

## The landing rule

`SessionAccessSystem.homeOf` decides from the token's roles alone, in this
order:

1. **Works the book** (`Roles.BOOK`: barber, receptionist, admin, sysadmin)
   lands on `/staff/schedule`.
2. **Manages the programs** (`Roles.CATALOG`) lands on `/admin/programs`.
   Once rule 1 has passed, only a content manager reaches this rule.
3. **Everyone else** lands on `/account`.

Each home is a route the same roles open, so a landing can never be refused.
The system's spec checks this for all 64 role sets. `landingOf` adds the
chair, and only on the schedule. `rootLandingOf` is `/`: an installed-app
launch by an active person lands on their home, and anyone else sees the
landing page.

`RedirectPath.intentOf` keeps only the question "is there a link to
follow". It used to name `/account` as the fallback (`authDestination`),
and that function is gone.

## Where it applies (`HomeLandingService`)

- **The installed app's `/`.** The manifest's `start_url` is `./`, so
  every launch passes the home gate.
- **Every post-sign-in navigation** with no link to follow. These are the
  sign-in code step and onboarding, five call sites.
- **`/admin`**, a door with no page of its own. It used to open the rhythm
  page, which sent a barber or a content manager to `/forbidden`.
- **`/forbidden`'s way out.** It now links to the person's home, even in a
  browser tab where `/` is the landing page.
- **A sign-in's remembered link.** The navigation carries a marker, and the
  role and capability gates answer a refusal of it with the home.

The two «Вход» links no longer send `?redirect=/account`. The menu's
rewards row keeps it, because there the link does mean the account page.

## Not decided here (the brief's open questions)

- **Q5:** whether a signed-in staff member's browser tab on `/` should also
  skip the landing page. It doesn't today; `rootLandingOf` takes
  `standalone` for this reason.
- **Q6–Q11:** the client's «same cut» card, where the due-back date is
  stored, outreach and privacy, attribution, multi-location, and the window
  in which a role change reaches the landing (one token refresh).

## «Пак същото» (step 4, ruling Q6)

When no visit is booked ahead, `/account` leads with the visit the
person had last, as the shared visit card in its LAST slot: «Пак
същото», the services, the day and the barber. One tap opens
`/book?repeat=<id>` with that visit's basket, on the step that asks when.

- **One rule for both sides of the promise.** `SameAgainSystem` picks the
  visit (`sourceOf`: the newest one completed, or confirmed and begun on
  its own shop's clock) and says what today's public catalogue can book of
  it (`reachOf`: each seat kept, left with no barber chosen, or left out).
  The card words that answer, and the booking flow's pre-fill rebuilds the
  basket from it (`rebookSeats`), so the card never promises a barber the
  basket cannot hold.
- **The lead slot fills once:** the next visit, else «Пак същото», else
  the empty state. It shows a skeleton until each part it needs has
  answered. The history read (the account's newest 10 visits) opens only
  when nothing is next.
- **No new listener, no images.** `/account` reads the three catalogue
  queries directly; the SDK shares them with the site menu. It does not
  go through `CatalogContentService`, which resolves every cover and face
  as soon as it exists and would bring the shared catalogue chunk (45 kB)
  into the route. A card's barber is drawn as a monogram.
- **Honest variants.** A barber off the public list: «Иван вече не приема
  онлайн часове — избери час при друг бръснар.», and the basket leaves the
  barber open. A retired service: «… вече не се предлага.», and the basket
  leaves it out. Nothing left to book: the empty state.
