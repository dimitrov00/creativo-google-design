# The sign-in email sender, and the limits in front of it (2026-11-17)

> **Status: DECIDED, built** (team onboarding stage 2, the code half). Owner,
> 2026-11-17: "Yes, start it", to the recommendation of Postmark, sending
> limits first, and email only. Amended the same day (owner: "lets tighten
> it"): Postmark has no spending cap, so S4's ceiling went from one call a
> second per instance to one every 20 s, and S5 gained an alert. The owner's
> part (the account, the domain, the secrets) is in
> `docs/production-deploy.md`, «Sign-in: the OTP sender».

## The problem

A deployed project could not sign anyone in. The deployed branch wired
`refusingOtpSender`, which answered every code request
`IDENTITY_OTP_SEND_UNAVAILABLE`, and preflight P8 refused every functions
deploy while it was wired. Staff invites (stage 3) wait on the same sender.

A real sender turns the code request into something a stranger can aim at
someone else's inbox, and at the bill. The performance and cost audit found
the request had one limit only (F-21): one code per address per 60 s, with
no daily cap and no ceiling. Every new address also wrote two permanent
documents (F-22).

That one limit leaked as well. The resend check searched for the parsed
address (`ana@mail.com`) while the challenge stored the text as typed
(`Ana@Mail.com`, F2-10). A mixed-case address never met its own throttle,
and the erasure's sweep missed it.

## Decisions

| #   | Question                         | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Which provider?                  | Postmark. It sends transactional mail only, keeps broadcast mail on separate streams by design (the owner's rule: codes never share an identity with campaigns), and the console sender's comment already named it. Its API is one HTTP call, so the adapter needs no SDK. One Postmark **server** is the login-OTP identity: its own token, its own `auth.*` address.                                                                                                                                                                                                                                                                                                                                                                  |
| S2  | Which channels?                  | Email only, as the owner ruled and as the deployment challenges (`AuthDeployment.DEFAULT` is `EMAIL_OTP`). An SMS destination is refused `IDENTITY_OTP_SEND_UNAVAILABLE`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S3  | What limits a single inbox?      | At most **five unused codes per address in any 24 h** (`OtpLimits.DailyCodesPerDestination`, `IDENTITY_OTP_DAILY_LIMIT`), beside the 60 s resend window. It counts only codes nobody entered: a person signing in uses each one and is never counted, while a stranger's inbox receives at most five a day. It reads the challenges the request already reads (index #10, from a wider window), stores nothing new, and the `otps` TTL (expiry + 24 h) keeps every row it counts. The daily answer comes before the countdown, which would promise a code that cannot come.                                                                                                                                                             |
| S4  | What limits every inbox at once? | The existing per-instance token bucket (`throttledCallable`, the client issue sink's pattern) on `requestOtpChallenge`: a burst of ten, then one call every 20 s, on two instances at most. That makes a burst of twenty, then one code every 10 s for the whole project: at most about 8,660 a day, against a shop's few dozen. The bucket now takes a refill time per call (`refillMsPerCall`), since a whole number of calls a second could not go below one. A refused call is `resource-exhausted` before any read or write: no document, no row, no message. Under a flood, real sign-ins wait too; accepted at this size. (First merged at one call a second per instance, about 173,000 a day; tightened the same day, see S5.) |
| S5  | What caps the money?             | Postmark has **no spending cap**: past the plan's volume it keeps sending, e-mails the account once and bills the extra next month (Basic: $1.80 per 1,000). So the ceiling in S4 is the cap: a full day of flooding costs about $16 of overage on Basic. The `otp_code_sent` alert (`tools/ops/alerts/otp-codes-sent.yaml`, more than 100 codes in an hour) says so the same hour; it counts one `otp.sent` line per accepted code, which carries Postmark's `MessageID` alone.                                                                                                                                                                                                                                                        |
| S6  | How is the address stored?       | As its own probe reads it: the parsed identifier (a lower-cased email, an E.164 phone). This closes F2-10's gap, and `verifyOtp`'s re-parse always passes it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S7  | Where do the settings live?      | Two Secret Manager secrets, `OTP_POSTMARK_TOKEN` and `OTP_EMAIL_FROM`, bound to `requestOtpChallenge` alone and read at each send. The from-address is not secret, but a Firebase param would be overwritten by the generated `.env` on every build; Secret Manager is the one per-project store that survives. The emulator gets fixed test values and never sends.                                                                                                                                                                                                                                                                                                                                                                    |
| S8  | What does a refusal say?         | It is sorted by what fixes it. Operator problems (a bad token, an unapproved account, the from-address, the stream) answer `IDENTITY_OTP_SEND_UNAVAILABLE`, logged at `error`, with no retry offered. Address problems (invalid, or suppressed after a bounce or complaint) are an invalid request. Time problems (a rate limit, Postmark down, a timeout) mean unavailable for now. The one log line holds the reason, the HTTP status and Postmark's `ErrorCode`, never the address, the code or the token.                                                                                                                                                                                                                           |
| S9  | What does the message say?       | It follows Apple's code mails: the code in the subject, so notifications and code autofill find it. Then one line on how to use it and how long it lasts (the deployment's own `ttlMinutes`), one line that nobody will ask for it, and one line for a person who didn't request it. It is in Bulgarian, uses no gendered forms, and has no link, no image and no tracking. It echoes nothing the caller typed.                                                                                                                                                                                                                                                                                                                         |

## Rejected

- **A stored counter or IP bucket.** A global daily counter is one hot
  document under a flood, and a per-IP bucket adds writes and a TTL of its
  own. The per-address count reuses rows already read (zoom-out review §6).
- **A country allowlist or App Check for launch.** A country limit does
  nothing for email. App Check is a staged rollout (`OFF → MONITOR →
ENFORCE`) of its own, and it is a condition of adopting SMS (review round 2).
- **Throttling only off the emulator.** The e2e suites request a handful of
  codes, so the emulator keeps production's bucket. Its burst stays ten per
  instance so they never meet it.
- **One instance instead of two.** One bucket would halve the ceiling, but
  a crash or a deploy would leave no instance to answer. The rate per
  instance is lowered instead.
- **A Postmark-side cap.** There is none to set (its pricing FAQ and its
  billing article name only the notice e-mail).

## Left

- The owner's steps: the Postmark account and its approval, the `auth.*`
  domain's DKIM, Return-Path and DMARC records, the plan, and the two
  secrets.
- The message is Bulgarian only: the request carries no locale yet.
- A suppressed address ("inactive recipient") gets the generic «couldn't
  send» words. Naming it ("emails to this address bounce, try another") is a
  follow-up.
- Staff invites (stage 3) will send through the same Postmark server under
  their own tag.
- Delivery tracking in the app: Postmark's delivery and bounce webhooks into
  a short-lived record per message, keyed by a digest of the address, for an
  admin lookup and the sign-in screen's bounce words. Until then, Postmark's
  activity view answers "did my code arrive?" for 45 days.
