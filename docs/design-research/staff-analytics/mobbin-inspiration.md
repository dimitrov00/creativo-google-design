# Staff analytics — Mobbin inspiration (2026-11-07)

Screens pulled from Mobbin (iOS) while scoping staff analytics. What each one does well and
what to take from it.

## Earnings and performance for one worker (closest to a barber)

- [DoorDash Dasher — weekly pay](https://mobbin.com/screens/1371715f-7794-424b-8b4d-00bc11a8b620):
  the week's total on top, then its parts (base pay, adjustment, tips), then **active time vs
  dash time** and completed deliveries, then the list of days that make it up. This is the
  barber's "takings, tips, worked time vs rostered time" in one screen, with a drill-down by day.
- [Airtasker — tasker dashboard](https://mobbin.com/screens/e8c2be58-e311-41ff-b80a-14963418a6f5):
  scores with a plain-word verdict and a progress bar toward the next level. A pattern for
  goals ("€880 away from…"), to use carefully.
- [Fiverr — level overview](https://mobbin.com/screens/306665ba-d220-4124-9493-85f6f1c269bb):
  each metric shown as current / target, with the targets listed beneath.
- [Turo — business performance](https://mobbin.com/screens/7466694a-1276-4034-b79b-c6e72360cca4):
  date range on top, each metric card has a figure, a target badge and a sentence on how to
  improve it.
- [Airbnb — host insights](https://mobbin.com/screens/ec1e902b-2557-4657-913c-9d29c531a542):
  tabs "Opportunities / Stats"; an honest empty state ("shown after 3 reviews") — the
  small-sample rule in practice.

## Revolut presentation

- [Revolut — spent, by category](https://mobbin.com/screens/69913e7a-7c90-4051-9fe1-84f2f55920d9):
  one big figure, its average per month, a bar chart with an average line, a 1W / 1M / 6M / 1Y
  segmented switch, then "By category" rows with count and share %. The model for "takings by
  service" and "time by kind".
- [Revolut — category detail](https://mobbin.com/screens/2686bb67-c266-4d1a-86bc-98dbd187befc):
  tapping a category lists the transactions behind it, grouped by date — the drill-down rule.
- [Revolut — set budget](https://mobbin.com/screens/fd4141ce-52a5-4b6e-adcd-afce1d423675):
  a goal shown against "last 30 days". A barber's monthly takings goal could follow this.
- [Revolut Business — merchant revenue](https://mobbin.com/screens/4cbc7fb1-eaaa-4067-9e4b-d42b9cb4a7bf):
  dark cards, one figure plus an area chart per card, date-range chip on top.

## Owner dashboards

- [Jobber — business health](https://mobbin.com/screens/5097dfd2-931a-4947-9e84-1e629562b152):
  grouped rows (quotes, jobs, invoices), each a figure with a coloured change chip against the
  previous period. Dense and readable on a phone; close to what the admin needs.
- [Shopify — analytics](https://mobbin.com/screens/bd4f59e6-3b6e-405b-a981-69073d590a4b):
  returning customer rate as a headline metric next to sales over time.
- [Squarespace — analytics](https://mobbin.com/screens/95c1e09a-7efe-4d29-a1f8-ddd422d40d61):
  three figures per row each with a sparkline and day/day change.
- [Cash App — earnings](https://mobbin.com/screens/dc7db548-1b0b-4980-b7f0-779609a93904):
  daily bars for the month, key stats, then "top customers" — the barber's top clients.
- [YouTube Studio — overview](https://mobbin.com/screens/0b2b3c07-0f31-4182-8f32-275416a0e2fe):
  "Not enough data to show this report" as a designed state, plus a realtime card.

## Time breakdowns (the free-time question)

- [Toggl Track — reports](https://mobbin.com/screens/8316d97f-610a-406c-b6f4-60003a4befe8):
  week bars on top, then time grouped by project with share % and hours — maps to "time by
  kind: worked / blocked / unsold".
- [Opal — weekly story](https://mobbin.com/screens/ea59c327-1787-47dc-b850-15708c5e337d):
  a sentence names the best and worst day above the bars. Pattern for the weekly digest
  ("Thursday was your emptiest day").
- [Google Maps Timeline — insights](https://mobbin.com/screens/ba487892-7d99-4eda-8653-c67e3cf06d72):
  each category row carries its own small month-by-month bar chart — trend inside the row.
- [Jomo — most used](https://mobbin.com/screens/1e81e6f2-25ef-4787-8471-1fc3448d9688):
  hour-of-day bars over a day — the shape for "busy hours" per weekday.

## Patterns to adopt

1. Hero figure + change vs previous period + period switcher (Revolut, Jobber).
2. "By category" rows with count, share and a share bar; each row opens its source list.
3. Time shown as a breakdown with words for each part (DoorDash active vs dash time, Toggl).
4. One generated sentence naming the best and worst day/hour (Opal), computed by a system.
5. Designed small-sample and empty states (Airbnb, YouTube Studio).
6. Targets only where the person set them (Revolut budget), never imposed levels.
