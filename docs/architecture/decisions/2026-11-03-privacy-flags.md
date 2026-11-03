# The Phase 3 privacy flags — rulings (2026-11-03, owner-delegated)

> **Status: RULED (2026-11-03).** Seven open flags of the audit hardening's
> Phase 3 (`docs/architecture/flips/audit-hardening-phase-3.md` §7 items 8,
> 12, 13, 24, 25, 27, 28), carried as one line of the HANDOFF §3.3
> "next pass" checklist. Each is ruled below; none changes code. Two are
> deferred to an evidence trigger, two are accepted as built, and three are
> accepted as built with the remedy added to the runbook. The owner
> keeps the legal half of items 24 and 28 (the counsel review already on
> the owner's list).

> **Authority.** The owner delegated open decisions on 2026-10-26 (_"make
> decisions by how you would do it — FAANG grade decisions, performant and
> creative"_) and asked on 2026-11-03 for the HANDOFF's next-pass items to
> be picked up before feature work. The rubric is the one of
> `2026-10-26-owner-rulings.md`: **C** correctness · **S** security and
> privacy · **P** performance and cost · **T** one source of truth · **U**
> UX · **M** simplicity (YAGNI) · **R** reversibility.

**The frame.** All seven are edge cases of a feature that is dark in
production: `client.privacy` stays `false` until the owner lights it
(`production-deploy.md`, "Data-subject requests"), and nothing is deployed.
The shop is one barbershop. A data-subject request has a legal clock of one
month, extendable by two (GDPR Art. 12(3)), so a procedure built when a
case first appears still answers it in time. Every flag below already
fails safe: a refusal, never a partial answer or a silent loss. The bar for
building now was therefore a gap that leaks a personal value or loses one
for good. None of the seven met it.

---

## PF-1 — A person past the export cap (flag 8): built on first refusal

**Question.** The export refuses a person past 20,000 documents or 4 MiB
(`EXPORT_MAX_DOCUMENTS`, `EXPORT_MAX_BYTES`,
`libs/ecs-core/src/systems/client-export.system.ts:56`, `:62`). The erasure
refuses past 5,000 documents in any one list. Should a runbook export (the
research's Storage ZIP) be built now?

**Evidence.** A weekly client for ten years is about 520 visits. With
their journal and audit rows that is under 3,000 documents, and a visit's
canonical JSON is about 1 KB. The byte cap is the one a person could
reach, at roughly 4,000 visits. The refusal is certain (the reads stop at
the cap + 1), is worded to the admin, and is never truncated.

**Ruling.** Not built now (**M**, **P**; **S** unchanged: refused, never
partial). Build trigger: the first `PRIVACY_EXPORT_TOO_LARGE` or
`PRIVACY_ERASURE_TOO_LARGE`. The legal month covers the build. What the
admin does in the meantime is in `production-deploy.md`'s data-subject
item: record the request date, tell the person the answer is coming, and
open the engineering task.

## PF-2 — A note or photo written after the erasure completed (flag 12): keep the admin re-sweep

**Question.** A note or photo written on an old visit of an erased person
stays until an admin's next erasure call re-sweeps it
(`PRIVACY_CLIENT_ERASURE_RESWEPT`, P3-L-19). Should the sweep be automatic?

**Options.**

- **(a)** A trigger on every note and photo create: read the visit and its
  records, then delete. That is a new export, a new pipeline and a read per
  write.
- **(b)** A visit-level erasure stamp that the notes and photos rules read
  instead of today's `exists()`. That costs no extra read, but it adds a
  field to the Appointment archetype, changes the rules and needs their
  emulator suite.
- **(c)** Keep the admin's re-sweep, offered on the card beside «Изтрит
  клиент».

**Ruling.** (c) for now (**M**, **R**). After the stamp, the visit's seat
and contact are pseudonymous, so a writer cannot tell whose visit it is
and the new note holds no value that names the person. The real risk is a
photo (an image is personal data), for example one taken offline before
the erasure and uploaded after it. Build trigger: before `client.privacy`
is lit for a shop that uses the camera capture. Then build (b), the cheaper
read path, in its own change with the rules suite.

## PF-3 — A returning person's phone is never a walk-in again (flag 13): accepted

**Question.** The walk-in record id is a keyed hash of the phone
(`CustomerId.forWalkIn`, OR-26). An erased record keeps its id (P3-RU-20,
no resurrection), so the same phone can never seed a walk-in record again.
Should a generation scheme be designed?

**Ruling.** Accepted as built (**S**: refuse rather than re-link a person
who asked to be forgotten; **M**). The desk books such a person as an
anonymous guest (`BOOKING_CLIENT_ERASED` says so), and a person who signs
up gets an account record, which is keyed by the uid and not the phone.
Any generation scheme stores a per-phone counter beside the erased id, and
that weighs against the erasure itself. Build trigger: the desk meeting the
case in practice.

## PF-4 — A contact matched by value may name a phone-sharer (flag 24): accepted; counsel keeps the export half

**Ruling.** Accepted as built (**S**). The erasure errs toward clearing a
visit contact under the person's own phone or e-mail, even when the name on
it is a family member's (P3-L-12). Erring that way loses a family member's
name on an old visit, while the other way would keep the person's own
phone. The export showing that contact to the phone's owner is a question
of whose data it is, and it joins the counsel review already on the
owner's list (HANDOFF §3.3, "Legal review"). Not built: matching the name
too, or clearing the phone and keeping the name. Both need that review
first.

## PF-5 — A `REMOVE_SEAT` after the stamp may orphan an override contact (flag 25): accepted

**Question.** A visit whose contact was typed with values other than the
person's stored ones is found only through the person's seat. If the desk
removes that seat between the erasure's stamp and the visit's unit commit,
the contact is not found again. Should the edit pipeline refuse a
`REMOVE_SEAT` of a record under erasure, or clear the contact at the
source?

**Ruling.** Accepted as built (**M**, **P**, **R**). The window is the
seconds of one erasure call. It stays open longer only while a stopped
erasure waits for the admin's next tap. Both remedies cost every edit: a
read per removed seat in the transaction plus a refusal code and its copy,
or a change to desk behaviour. The admin's next call re-reads the footprint,
and the orphan needs an override contact AND a seat removal inside that
window. Build trigger: the first orphan found (the census's residue line
shows one).

## PF-6 — A missing `users` document refuses the erasure (flag 27): kept fail-closed; the remedy is in the runbook

**Ruling.** Kept as built (**S** first): with an Auth user and no `users`
document, nothing proves the account is not an operator's, because roles
reach a session only through the stored document (P3-DEP-29). Erasing it
could remove the shop's admin. The remedy is an operator's, and it is now
written down in `production-deploy.md`'s data-subject item. Confirm in the
console that the uid is in no staff list (the `barbers` documents, the
shop's own records of its staff). Then delete that Auth user, or restore
the `users` document from a backup, and run the erasure again.

## PF-7 — The STARTED census undercounts an earlier call's sweep (flag 28): accepted

**Ruling.** Accepted as built (**T**, **M**). Every clear is audited: the
earlier call's `PRIVACY_CLIENT_ERASURE_SWEPT` row holds its census before
the sweep, the swept contacts included (P3-DEP-33). Only the STARTED row's
`erasureContactCount` reads as "the contacts left when the stamp landed".
`firestore-runbook.md` §1.1 already defines it that way. Both fixes cost
more than they return: moving the stamp into the last sweep chunk's
transaction would drop the mid-sweep budget stop, and a swept count adds
state to a stateless census (P3-RU-22).
