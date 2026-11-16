# Account first, never account only — adding, onboarding and bringing back a barber (2026-11-16)

> **Status: DECIDED, being built** (team onboarding stage 1c; the invite
> email itself waits for stage 2, the email provider). Owner question,
> 2026-11-16: "Shouldn't the account in the app be required? It should be
> like in GitLab, Jira, Confluence: you register first, and your account is
> selected and promoted to barber; an invited barber gets an onboarding
> overlay the first time they load the app … and what if a barber leaves
> and comes back in months or years — why not keep it as history?" The
> owner chose the recommendation below ("Go with your recommendations").

## The problem

A barber is two things in this app: a **record** clients book (name, photo,
prices, hours, shops) and, optionally, an **account** someone signs in
with. Team onboarding D5–D8 built the record first and linked an account
later («Свържи профил»). Seen from GitLab or Jira, where a member always
is an account, that reads backwards: the owner creates a person, then
hunts for their login.

## What comparable products do

| Product                         | Member without a login?                                    | How a login joins                                      |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| GitLab, Jira, Confluence        | No: membership is permission to use the tool               | The user registers, an admin adds the account          |
| Fresha, Square, Booksy (salons) | Yes: a team member is bookable whether or not they sign in | The business sends an invite; access is a setting      |
| Our app before this decision    | Yes                                                        | «Свържи профил» after the record exists; invites later |

A salon tool is different from a developer tool in one way that matters:
clients book the chair whether the person in it ever opens the app — an
older barber with no smartphone, a guest for two weeks, a course student.

## Decisions

| #   | Question                                     | Decision                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Is an account required for a barber?         | No. A record without an account stays bookable — the owner books for them.                                                                                                                                                                                                                                 |
| A2  | Which way does adding go?                    | Account first. «＋ → Бръснар» opens the account search; picking an account opens the add sheet with the name filled in and the account named, and «Добави» creates the record already linked. «Без профил» at the top of the search is the second way. «Покани по имейл» joins it with the email provider. |
| A3  | What happens when the link fails after add?  | The record stays (it is the bookable thing); the sheet says the account is not linked and the member page offers «Свържи профил». Never a record silently half-made.                                                                                                                                       |
| A4  | How does an invited or linked barber begin?  | On their first sign-in as a barber, a full-screen welcome sheet. Dismissable («По-късно»): a barber signing in with a client in the chair needs today's schedule, not a wizard.                                                                                                                            |
| A5  | What stays after it is dismissed?            | A setup card at the top of their own schedule until their part is done (photo, a line about them); the owner's items (prices, hours) are shown as the owner's. Like iOS «Finish setting up your iPhone».                                                                                                   |
| A6  | What is stored for it?                       | Only that the welcome was seen, on the account, so another device does not show it again. Progress is derived from the record (`StaffSetupSystem`), never stored.                                                                                                                                          |
| A7  | What does a return after months or years do? | It brings back the SAME record — name, photo, prices, past visits and statistics — as «Върни в екипа» already did.                                                                                                                                                                                         |
| A8  | Are the earlier working periods kept?        | Yes, on the record: a short list of the periods worked before the current one, so the page says «Работил: 03.2024 – 11.2025 · от 02.2027». The audit log keeps every leave and return as before.                                                                                                           |
| A9  | Does a return bring the account back?        | It offers to: «Със същия профил (Георги Иванов)», on by default when the account that left with the record can still be linked. Off, the record returns with no account, as before.                                                                                                                        |

## Order

1. A2, A3, A7–A9: buildable now (stage 1c, first PR).
2. A4–A6 for a barber the owner links: buildable now (second PR).
3. The email invite (A2's third way): stage 2, the email provider.
