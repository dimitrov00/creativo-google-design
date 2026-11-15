# One photo per barber — kept on the record, shared with the linked account (2026-11-15)

> **Status: PART BUILT** (the photo and its server call, stage T of
> `docs/designs/staff-permissions.md`; the account side follows). Owner
> question, 2026-11-15: "shouldn't we use the user's avatar for the barber
> photo — why differ? It might cause a UX confusion drift." The owner chose
> the recommendation below and asked that it follow how professional
> products handle it.

## The problem

Team onboarding D5 gave a barber record its own portrait
(`avatarMedia*`, an object under `media/`) and let a newcomer copy their
account avatar (`avatars/{uid}/original`) into it once. After that copy the
two are separate. A barber who has an account would have two photos, set in
two places, that drift apart: one on the booking page, another in the app's
own chrome.

## What comparable products do

| Product       | One photo per person?                                | Who sets it                                                                                                                                                                 |
| ------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresha        | Yes: the team member's photo shows in online booking | The owner, from the team member's page. A connected user's own photo is used; the business cannot delete it, but can replace what its workspace shows by uploading another. |
| Microsoft 365 | Yes: one profile photo, shown in every app           | The person, and an admin for them. A policy says which roles may change photos.                                                                                             |
| GitLab        | Yes: one avatar per account, shown everywhere        | The person; the users API lets an administrator set it.                                                                                                                     |

What they share: one photo per person, shown everywhere, that both the
person and an administrator can set. None keeps a second, public photo
beside the account's.

## Decisions

| #   | Question                                               | Decision                                                                                                                                                                                          |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | How many photos does a barber have?                    | One. It is kept on the barber record (`avatarMedia*`), because that is the public one and the shop's to manage.                                                                                   |
| F2  | Why not read the account's avatar?                     | A barber can exist and take bookings with no account; only an account's owner can write its avatar; and the account controls its lifetime. Each would leave the booking page without a face.      |
| F3  | What is the linked account's avatar?                   | The same picture. The server writes it to `avatars/{uid}/original` whenever it writes the record's, so every screen that shows the account shows the barber's photo with no change to a reader.   |
| F4  | Who sets it?                                           | Whoever `TEAM_PROFILES` reaches the record for: the barber themself, a content editor, the owner. One call, `setBarberPhoto`.                                                                     |
| F5  | How do the bytes arrive?                               | The browser downscales the picture and uploads it to a staging path only its own account can write and nobody can read. The call checks it, copies it into `media/`, and deletes the staged file. |
| F6  | What happens when an account is linked? (not built)    | A record with a photo gives it to the account. A record with none takes the account's avatar as its photo.                                                                                        |
| F7  | What does a linked barber's own picker do? (not built) | It sets the barber's photo, through the same call. There is no second picker, and the storage rule refuses a linked account a separate upload.                                                    |
| F8  | What happens on release, or when the barber leaves?    | Each side keeps its copy. The record's photo is the shop's; the account keeps the picture as its avatar and may change it again.                                                                  |

## F3 — Why a copy, and not a pointer

Options weighed:

1. **Readers follow the link.** Every screen that shows an account's face
   would ask whether the account is a barber and read the record's photo
   instead. Rejected: the faces are drawn in many places (visit rows, the
   client card, the menu), the link is staff-only by design
   (`barbers/{id}/restricted/link`), and a reader that forgets shows the
   wrong face.
2. **The record points at the account's object.** Rejected for F2's
   reasons, and because it would publish which account is which barber.
3. **The server writes both (chosen).** One writer, no reader changes, and
   the two cannot differ after a call that succeeded. It is a projection in
   the sense of Law 5: derived, rewritten by the one call that changes its
   source. A copy that fails is logged, the record's change stands, and the
   next photo repairs it.

## F5 — Why a staging path and a call

The rules cannot ask who may edit a barber: that is the owner's permission
cells, judged by `StaffAccessSystem.admit` on the stored account. So the
browser never writes under `media/`. It writes to
`staffUploads/{uid}/{name}` (its own account, staff only, an image under
5 MiB, no reads), and the call does the rest with the Admin SDK:

1. the token gate, then the stored account against `TEAM_PROFILES`, before
   any object is touched;
2. the staged object's size and type;
3. a copy to `media/barbers/{barberId}/{id}.jpg`, an unguessable name;
4. ONE commit: the stored account again, the record, its `avatarMedia*`
   fields and one `TEAM_BARBER_PHOTO_CHANGED` row;
5. the copy to the linked account's avatar, the staged file deleted, and
   the photo it replaced deleted.

The object exists before the record names it, so a reader never follows a
path to nothing. A refused commit deletes the copy it made. `media/` loses
its `list` permission: a record in preparation is staff-only, and its
photo's name must not be found by listing.

## What this does not decide

- Removing a photo. Replacing covers a wrong picture; a record with no
  photo shows initials.
- The blurhash and the focal point. A new photo has none and is cropped at
  its centre, as team onboarding D5 says.
- What becomes of the record's photo when the person's account is erased.
  It is the shop's picture of someone who worked there; the leaving stage
  (team onboarding 1b) decides.
