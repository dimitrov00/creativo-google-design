# Staff analytics: competitor research

Research date: 2026-11-07. Scope: what booking and gig-work products ship today for analytics
and reporting, who can see what, how it is presented, and what users say is missing. Web
research only; no product accounts were used, so nothing below was checked inside a live app.

**How to read the sourcing.**

- Every claim carries a link. Official help-centre and product pages are the primary sources.
- **[vendor claim]** marks a vendor's marketing or blog statement that its help docs do not back.
- **[unverified]** marks a claim from a third-party page, a search-result summary, or a source
  that could not be opened. Treat it as a lead, not a fact.
- **Access limits.** Reddit (reddit.com and its mirrors), Booksy's help centre
  (support.booksy.com), Capterra review pages, Revolut's help centre and blog, and Square's
  community threads all refused automated fetching (HTTP 403, or empty pages). For those
  sources this document relies on search-engine summaries of the pages and marks them
  **[unverified]**. In particular **no first-hand r/barber or r/hairstylist threads could be
  read**, so the complaints sections draw on vendor idea boards, community forums, app-store
  snippets and review aggregators instead.

---

## 1. Fresha

### 1a. Reports and metrics

Fresha's glossary lists **50 reports in seven categories**
([Reports and Insights glossary](https://www.fresha.com/help-center/knowledge-base/reports/270-reports-and-insights-glossary)).
Fresha's overview says 44 reports are free on every plan, and that the paid **Insights** add-on
adds premium reports, custom report building, folders and advanced permissions
([Reporting and analytics overview](https://www.fresha.com/help-center/knowledge-base/reports/614-reporting-and-analytics-overview)).
"(Insights)" below marks a report that needs the add-on.

| Category     | Reports                                                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboards   | Performance dashboard (overall business performance); Online presence dashboard (online sales and online clients)                                                                                                                                                                                                   |
| Sales        | Sales summary (excludes gift cards, tips and service charges); Sales by time period (Insights); Sales list; Sales log detail; Gift card by time period (Insights); Gift card list; Membership list; Discount summary; Taxes summary                                                                                 |
| Finance      | Finance summary; Payments summary (by method); Payment transactions; Cash flow summary; Cash flow statement; Service charges; Liability summary; Liability activity; Upfront payments by time period (Insights); Upfront payment list; Taxes list                                                                   |
| Appointments | Appointments summary (trends incl. cancellations and no-shows); Appointments list; Cancellations and no-show summary; Waitlist detail; Waitlist summary (Insights)                                                                                                                                                  |
| Team         | Working hours activity; Working hours summary; Break activity; Attendance summary (punctuality); Scheduled shifts; Team time off; Wages detail and summary; Pay summary; Fee deduction activity and summary; **Tips summary and detail**; **Commission activity and summary** (by team member, location, sale item) |
| Clients      | Client summary (Insights); Client list; Client insights (Insights)                                                                                                                                                                                                                                                  |
| Inventory    | Stock on hand; Stock movement summary and log; Product list; Ordered stock                                                                                                                                                                                                                                          |

**Performance insights panel** (the at-a-glance view,
[Access your Performance insights](https://www.fresha.com/help-center/knowledge-base/reports/100652-access-your-performance-insights)):

- Business performance summary: sales, appointments, client activity, channel performance.
- Team summary: revenue and bookings per team member, **occupancy rates**, top team members.
- Clients summary: confirmed appointments, new vs returning split, where new clients came from.
- Marketplace summary: long-term value of clients acquired through Fresha's marketplace, plus
  **predicted sales for the next seven days**.
- Date filter: Yesterday, Today, Week or Month. Location filter. The default is today and all
  locations, and filters reset when you leave the panel.
- Fresha publishes no formula for occupancy.

**Client retention metrics.** The Client summary report (Insights) defines the client groups
([Client summary report](https://www.fresha.com/help-center/knowledge-base/reports/331-client-summary-article-1)):

- _New_: first appointment falls inside the date range.
- _Returning_: first appointment came before the range.
- _Rebooked_: has an appointment scheduled after the range.
- _Walk-in_: has no client profile. Walk-ins are counted separately and excluded from the
  three groups above.
- The report shows % returning and % rebooked, each split by team member and by location.
- Cancelled appointments and no-shows are excluded.
- The help page itself labels "% Returning clients" twice with conflicting definitions.

The Client insights report adds per-client columns
([Client insights report](https://www.fresha.com/help-center/knowledge-base/reports/324-client-insights-report)):

- first and last appointment, and whether the client is rebooked;
- total appointments and total sales;
- referral source;
- **average days, weeks or months between appointments**.

### 1b. Permission model

- **Only the owner, or roles with "Can manage permission levels", edit permission roles.** Each
  workspace starts from templated roles that the owner can edit
  ([Create permission roles](https://www.fresha.com/help-center/knowledge-base/team/100687-create-permission-roles)).
- The Reports area of a role "determines whether a team member can view reports for the
  whole team or only their own performance" (same page).
- Two report toggles exist: _Access reporting_ (standard reports) and _Access reporting &
  insights_ (standard plus custom reports). Each report and folder can then be shared at
  _Full access / Can edit / View only / No access_
  ([Manage report access for team members](https://www.fresha.com/help-center/knowledge-base/reports/192-manage-report-access-for-team-members)).
- The Performance insights panel also needs _View all team members' data_
  ([Performance insights](https://www.fresha.com/help-center/knowledge-base/reports/100652-access-your-performance-insights)).
- **Insights is billed per bookable team member, whether or not that person can open reports**
  ([Upgrade to Insights](https://www.fresha.com/help-center/knowledge-base/reports/175-upgrade-to-insights-for-premium-reports)).
  Third-party price trackers put it at about $9.95 per bookable member per month in the US
  **[unverified]** ([costbench](https://www.costbench.com/software/salon-spa/fresha/)).

### 1c. Presentation

- Panel cards with day, week and month toggles, plus tabular reports with filters and
  saved custom reports (Insights).
- Export to PDF, CSV and XLSX
  ([overview](https://www.fresha.com/help-center/knowledge-base/reports/614-reporting-and-analytics-overview)).
- One forward-looking number: predicted sales for the next seven days.
- No goals or digests are documented. Fresha's help pages describe no period-over-period
  comparison in the panel.

### 1d. Complaints and gaps

- **Six reports, the client-retention views among them, sit behind a per-seat paywall.**
  Fresha's help pages also do not define occupancy.
- Capterra reviewers are split on reporting. Some call it "more than adequate". Others say it
  has "serious gaps", for example no cost-of-goods-sold report **[unverified, search summary
  of Capterra pages]**
  ([Capterra Fresha reviews](https://www.capterra.com/p/142138/Shedul-com/reviews/)).
- G2's top cons for Fresha are "Missing features" (47 mentions) and "Limited features" (40)
  **[unverified]** ([G2 comparison](https://www.g2.com/compare/fresha-vs-mindbody-vs-vagaro)).

---

## 2. Booksy Biz (barber-heavy)

### 2a. Reports and metrics

Booksy's feature page claims **50+ built-in reports** **[vendor claim]**. Its named categories
are Booking & cancellation trends, Sales & revenue, Transactions, Occupancy rates, Client
reports, Marketing reports, Staff performance, Staff commissions & tips, and Stock & inventory
([Stats & Reports feature page](https://biz.booksy.com/en-us/features/stats-and-reports)).

Booksy's blog describes eight Stats & Reports sections
([Start using Stats & Reports](https://biz.booksy.com/en-us/blog/start-using-stats-reports-to-better-manage-your-finances)):

| Section       | Metrics                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard     | Revenue, appointments, clients; **occupancy %**; confirmed, finished, no-shows, cancellations; time booked and revenue (Pro only)                   |
| Appointments  | Session count, time occupancy, **busiest days, peak hours**, revenue by appointment status, cancellations, no-shows, category and service summaries |
| Clients       | New vs returning, booking frequency, top/VIP clients, **clients who haven't booked recently**                                                       |
| Revenue       | By service, package, membership, product, gift card; appointment profitability; taxes; sales trends; outstanding invoices; discounts                |
| Cash flow     | Mobile payments, prepayments, cancellation fees, refunds, payout batches, cash register                                                             |
| Inventory     | Stock on hand, products used in the shop                                                                                                            |
| Staff members | **Tips, hours worked, time off, revenue per staff member, top-5 staff by revenue**                                                                  |
| Marketing     | Income and clients from Boost (Booksy's paid marketplace promotion), results of happy hours and flash sales                                         |

- **Tiers.** Booksy Biz Lite gets four sections (Dashboard, Revenue, Appointments, Clients).
  The full set needs Biz Pro, and Booksy recommends using it on a tablet or computer
  (same blog).
- **Commissions.** Commissions are calculated at checkout on services, products, gift cards,
  memberships and packages. They can be a percentage or a fixed amount, per staff member and
  per item. A staff commission report and a staff performance details report exist
  ([Booksy statistics blog](https://biz.booksy.com/blog/smart-business-managing-your-earnings-with-booksy-statistics-and-reports);
  [commission rates help](https://support.booksy.com/hc/en-gb/articles/28900308157970-How-do-I-set-default-and-staff-commission-rates)
  **[unverified, page blocked]**).
- **Tips.** A Tip report breaks tips down by payment method, staff member and month. It
  covers only appointments marked checkout-complete
  ([tips for tax deduction](https://support.booksy.com/hc/en-us/articles/30010145487634-How-can-Booksy-help-me-track-my-tips-for-the-tip-deduction)
  **[unverified, page blocked]**).

### 2b. Permission model

Booksy has five levels: **Owner, Manager, Receptionist, Staffer, Basic Staffer**. Sources: the
[staff permissions help article](https://support.booksy.com/hc/en-gb/articles/16535688940946-How-do-I-manage-staff-permissions)
and the
[Personal Wallet help article](https://support.booksy.com/hc/en-ie/articles/29317099041042-What-is-Personal-Wallet-and-how-do-I-navigate-it).
Both were blocked, so this section comes from search summaries **[unverified]**.

- **Owner and Manager.** They invite staff and set permissions, and their rights are nearly
  the same.
- **Receptionist.** Front-desk tools, plus viewing and downloading business reports.
- **Staffer.** Viewing and downloading reports are listed for this level; the exact scope is
  unclear.
- **Basic Staffer.** Manages only their own schedule and has no business wallet.
- **Personal Wallet.** A read-only view for Staffers and Basic Staffers that shows "their own
  performance": the last five transactions plus a full transaction history. Staff cannot see
  the business balance or anyone else's transactions. **Whether it shows commission or tips
  is not documented.**
- **The staff performance details report is built by an Owner or Manager**, then "shown or
  sent" to the staff member without exposing others' data
  ([staff performance report help](https://support.booksy.com/hc/en-gb/articles/16534905410066-Can-I-generate-a-staff-member-performance-report)
  **[unverified]**). It includes clients by client status and the staff member's reviews and
  rating. **The barber does not get a self-serve view; the owner hands the report over.**

### 2c. Presentation

- Graphs and percentages on a dashboard, with day, week, month, year and custom ranges.
  Printable and exportable reports
  ([blog](https://biz.booksy.com/en-us/blog/start-using-stats-reports-to-better-manage-your-finances)).
- Dashboard mock-ups show percentage-change badges such as "+15% revenue", but Booksy
  documents no comparison tool
  ([feature page](https://biz.booksy.com/en-us/features/stats-and-reports)).
- No goals or digests are documented.

### 2d. Complaints and gaps

- **The deepest stats need the Pro tier on a tablet or desktop.** On the phone, where barbers
  work, Lite shows four sections (see 2a).
- App Store: a reviewer reports "serious issues with the reports and stats section for days"
  and no fix from support **[unverified, search snippet]**
  ([Booksy Biz App Store listing](https://apps.apple.com/au/app/id725335996)).
- Reviewers distrust Boost attribution, which feeds the Marketing stats: walk-ins who used a
  shop QR code were counted as Boost bookings and charged commission **[unverified]**
  ([Trustpilot](https://www.trustpilot.com/review/booksy.com?page=1)). **This is a trust
  problem with how the numbers are derived**, not with how they are displayed.

---

## 3. Square Appointments

### 3a. Reports and metrics

**Team performance report** (Plus and Premium plans)
([Square Appointments reporting](https://squareup.com/help/us/en/article/7904-square-appointments-reporting)).
The report is built from appointment data, not sales.

- **Client retention** = returning clients ÷ total clients. A client counts as returning if they
  visited in the year before the date range.
- **Pre-booking** = visits where the next appointment was booked within 24 hours of the
  current one ending ÷ total visits.
- **Schedule utilization** = booked hours ÷ scheduled working hours.
- Cancellations and no-shows are excluded. Recurring appointments are only partly supported.
- Filters: date (one year at most), location, team member, service. "See details" drills down
  to staff level.

**Commissions** (Appointments Premium and some other plans)
([Set up commission tracking](https://squareup.com/help/gb/en/article/7145-set-up-commission-tracking)):

- None, a flat rate, or tiers based on the team member's service sales.
- Commissions flow into reports and into Square Payroll as estimated earnings per pay period.
- Package-paid services must be checked by hand under Item sales.

**Staff-facing app.** The separate **Square Team** app shows each team member their
timecards, scheduled hours and **estimated pay including tips and commissions**, plus pay
stubs. Tips show even when the shop uses a third-party payroll provider
([Square timecards help](https://squareup.com/help/us/en/article/5742);
[Square Team on the App Store](https://apps.apple.com/us/app/square-team/id1435368303)).

### 3b. Permission model

- **Appointments reports.** Owners, or roles with the "view appointments reports" or "view all
  team members reporting" permission
  ([7904](https://squareup.com/help/us/en/article/7904-square-appointments-reporting)).
- **Sales reports.** "View Sales Reporting" (limited or detailed) and "View Detailed Sales
  Reporting", which shows per-item and per-team-member totals
  ([permissions](https://square.com/help/ie/en/article/5822-employee-permissions)).
- **No clean "my own numbers only" scope.** In Square's community forum, owners report that
  "limited" sales reporting limits how far back staff can see, not whose data. One owner says
  turning everything off except "view personal reporting" left staff with nothing
  **[unverified, thread titles and search summaries]**
  ([own-reports thread](https://community.squareup.com/t5/Appointments-Bookings/How-do-my-employees-view-their-reposts-and-not-the-entire-salon/m-p/787117);
  [device-only reports thread](https://community.squareup.com/t5/Archived-Discussions-Read-Only/Report-Permissions-Device-Only-Sales-Reports-for-Team-Members/td-p/627160)).
  A moderator points staff to the Square Team app for their own tips and commissions instead.

### 3c. Presentation

- Dashboard reports with filters and drill-downs.
- **The staff member's money lives in a separate app (Square Team) from the owner's reports.**

### 3d. Complaints and gaps

Square's archived ideas thread collects requests from 2019 to 2022
([feature request thread](https://community.squareup.com/t5/Archived-Ideas-Read-Only/Feature-Request-Include-number-of-appointments-booked-vs/idc-p/152141/highlight/true)):

- **Appointments booked vs completed, per stylist.**
- Retention and rebooking rate filterable by team member. This was later partly delivered by
  the Team performance report.
- **A per-appointment payroll view** (client, service amount, tip, per staff member) for
  commission pay. Owners compiled it by hand.

Other community threads report that the mobile app and the Dashboard show different sales
totals, and that the Team Sales report disagrees with the POS sales report **[unverified,
thread titles]**
([thread](https://community.squareup.com/t5/Appointments-Bookings/Different-sales-reports-on-square-appointment-mobile-app-and/td-p/746020);
[thread](https://community.squareup.com/t5/Reports-Setup-Management/Report-Inconsistencies-between-the-Dashboard-Team-Sales-Report/m-p/832802)).

---

## 4. Boulevard (premium salon) and Vagaro

### 4a. Boulevard

**Dashboards** ([Getting started with Boulevard reporting](https://intercom.help/joinboulevard/en/articles/15608565-getting-started-with-boulevard-reporting)):

- Two fixed dashboards, _Business summary_ (overall performance and period comparisons) and
  _Sales summary_.
- Filters: date, location, staff. Neither dashboard can be customised.
- Each widget links through to its source report.
- Saved report configurations ("Views") can be private or published business-wide.

**Detailed reports** in six categories
([Detailed reports](https://intercom.help/joinboulevard/en/articles/15609033-detailed-reports)):

- **Staff Operations**: commission summary and line items (commissions and tips per staff
  member), staff performance, **staff client retention**, staff retail sales, staff service
  sales, schedule entries, time cards and time blocks.
- **Clients**: client retention (return rates by location and time window), client ratings by
  staff, referral performance, waitlist and others.
- Appointments, Financials, Catalog, Marketing.

**The staff performance report is the most complete per-provider metric set found**
([Staff performance report](https://intercom.help/joinboulevard/en/articles/15591178-staff-performance-report)).
Its column groups:

- **Hours**: Hours Scheduled, Hours Booked, Hours Clocked, Business and Personal Blocked
  Hours.
- **Utilization %** = booked ÷ (scheduled − business blocks). Personal blocks are not
  deducted, and a value above 100% means bookings ran outside shift hours.
  **Booked to Scheduled %** is the same ratio without the deduction.
- **Booking source**:
  - Requested appointments and **Staff Requested %** (the client asked for this provider);
  - **Prebooked %** (booked on the service day);
  - **Self-booked %** (online);
  - **Add-on appointment %**.
- **Clients**: Service Client Count; New Client Count and %; Returning Client Count and %;
  new and returning each split into _requested vs non-requested_.
- **Retail**: **Retail Conversion %** (share of clients with an appointment who also bought
  retail) and **Retail to Service %**.
- **Money**: Service Net Amount per Appointment, Net Amount per Order, discretionary
  discounts, gratuity (net of refunds), refunds and refund clawback from staff, memberships,
  packages, gift cards.

**Permission model** ([Reporting permissions](https://intercom.help/joinboulevard/en/articles/15609508-reporting-permissions)):

- A master "Reporting Management" permission, plus add-ons: Export, Access Mobile Reports,
  Publish views.
- Most categories come in an **Everyone or Self** tier: Sales, Schedule & Attendance,
  Performance, Commissions, Client Insights, Appointments.
- Staff see only the locations on their profile. Dashboard widgets show a restriction message
  when the person cannot open the underlying report.
- **Two caveats**:
  - mobile reporting is still all-or-nothing under the legacy permissions;
  - the legacy "Former Summaries and Reports" ignore the new scoping, so anyone with that
    permission sees all sales and financial data.

**Presentation patterns.**

- Boulevard's blog suggests a review cadence **[vendor claim]**
  ([salon reports blog](https://www.joinblvd.com/blog/salon-reports)):
  - daily: end-of-day totals;
  - weekly: staff performance and no-shows;
  - monthly: retention, average ticket, inventory;
  - quarterly: year-over-year growth.
- The same post claims "automated alerts" for key metrics **[vendor claim; help docs reviewed
  do not describe alerts]**.

**Complaints and gaps.**

- An idea-board post (Nov 2025, 5 votes) calls reporting "just raw data" that users export
  and analyse themselves. It asks to "compare time periods and see change and % change over
  time", and says reporting is "quite out of date" next to Square
  ([Report Analytics idea](https://boulevard.uservoice.com/forums/949798-ideas-hub/suggestions/50741291-report-analytics)).
- A Jan 2026 post (9 votes) asks that **individual providers can generate and view their own
  performance**:
  - sales including retail and enhancements;
  - rebooking rate;
  - average tip;
  - average ticket;
  - client retention;
  - filters for week, month, quarter and year.

  ([provider self-view idea](https://boulevard.uservoice.com/forums/949798-ideas-hub/suggestions/50931875-i-would-love-to-see-an-option-in-boulevard-that-al)).
  The "Self" tier exists on the web, so the request likely reflects the all-or-nothing mobile
  gap, or providers not knowing about the tier. That is an inference.

### 4b. Vagaro

Vagaro's own support centre could not be reached, so this section relies on Vagaro's
marketing "learn" pages.

- **Reports** ([7 Vagaro reports](https://www.vagaro.com/en-au/learn/7-vagaro-reports-for-schedulicity-users)):
  - Sales by Provider: items sold, tips, taxes and fees, net of discounts and refunds.
  - Customer product and appointment histories.
  - Print Daily Plan.
  - **Appointments Summary**: counts by status as a bar chart by day, week, month or year.
  - **Booking Percentage**: available hours, booked hours (including add-on and cleanup time),
    booking %.
  - **Cancellations & No Shows**, with who changed the status and when.
  - Packages.
- **Dashboard.** Vagaro describes a real-time KPI snapshot ("Dashboard Reports"), but no
  official page listing its widgets was found **[unverified]**
  ([Vagaro reports page](https://as-marketing-wus2-as-marketing-wus2-main.azurewebsites.net/pro/reports)).
- **Permissions.** Access Levels with separate "run own reports" and "run others' reports"
  rights, under Settings → Employees → Access Levels **[unverified, third-party integration
  guide]** ([Bench help](https://help.bench.co/third-party-login-instructions/vagaro)).
- **Complaints.** One Capterra reviewer says a returning guest has to be flagged by hand when
  rebooking **[unverified, search summary]**
  ([Capterra Vagaro](https://www.capterra.com/p/153752/Vagaro/reviews/)).

> Note: a page on shortcuts.help ("Employee Performance Summary: Extended", with rebook %,
> retail average ticket and retail-to-service %) surfaced in a Vagaro search, but it documents
> **Shortcuts** salon software, not Vagaro.

### 4c. Barber-specific tools worth knowing

**theCut** (US, barber-only)
([new barber homepage](https://help.thecut.co/en/articles/12622972-introducing-thenew-barber-homepage)):

- **Stats sit below today's appointment timeline on the home screen.**
- They track eight areas: bookings, revenue, transactions by payment type, **tips**, **hours
  booked**, reviews, new clients and **profile views**.
- Day, week and month views. Tapping a bar updates the totals for that date.
- **The help article tells barbers to read metrics in pairs**:
  - profile views vs bookings ("if views are high but bookings low, fix your profile");
  - bookings vs reviews;
  - hours booked vs revenue.
- This is the closest shipped analogue to "a barber's own numbers on the phone".

**Squire** (US barbershop software):

- Markets a "Reporting Assistant" that answers plain-language questions, such as which
  barber had the highest rebooking rate last month **[vendor claim; page blocked, search
  summary]** ([Squire reporting article](https://getsquire.com/business-edge/barbershop-reporting-software)).
- A Square-partner blog says Squire's analytics are less deep than Square's **[biased
  source]** ([perdiem blog](https://www.tryperdiem.com/blog-posts-v2/square-vs-squire-which-booking-software-is-best-for-barbershops-in-2024)).

**Phorest** (salon software):

- Sells benchmark reports that compare a salon's rebooking, retention, retail-to-service ratio
  and average ticket with **local, national and top-performer** peers. The reports are
  refreshed every few months
  ([Phorest insights](https://www.phorest.com/blog/phorest-insights-data-and-learnings-from-over-10000-salons)).
- A search summary says Phorest can alert when the rebooking rate falls below a threshold
  **[unverified]**.

---

## 5. Calendly (brief)

[Calendly analytics help](https://calendly.com/help/calendly-analytics):

- **Widgets**: created, completed, rescheduled and canceled events; distribution by duration;
  popular event types; **popular times** (interactive heat-style widget).
- Up to one year of data. Filters by date, user, team, group and event type.
  Admins can choose which widgets to show. CSV export of event or user data.
- **Permissions**: the dashboard is for Owners and Admins. **Regular users see only their own
  event data.** Paid plans only.
- **Pattern worth borrowing**: every widget has an info icon explaining the metric.

---

## 6. Uber Driver and similar gig earnings screens

The closest analogue to "my earnings and my free time".

### 6a. What is shown

([Uber earnings basics](https://www.uber.com/us/en/drive/basics/earnings/))

- **After each session (on going offline)**: time online, amount earned, trips offered vs
  completed. The example shows $52.41 over about 75 minutes, 4 of 4 trips.
- **Weekly summary card**:
  - total earnings, active hours and trips (example: $152.05, 23 h 10 min active, 70 trips);
  - loyalty points;
  - **a bar chart of activity by day**.
- **Earnings tab**:
  - daily and weekly totals, trip-by-trip breakdown, adjustments, promotions, upcoming
    deposits;
  - each week shows **how the fare was split** between driver, Uber, insurance and
    government fees.
- **Weekly statement** (emailed every Monday, with a web archive):
  - total earned and amount already cashed out;
  - trips, promotions and tips itemised;
  - **prior-week adjustments shown separately**, such as a tip added days later.

  ([courier statements](https://www.uber.com/us/en/blog/courier-statements/)).

- **Goals and trackers**:
  - Uber's driver-app page says drivers "track their progress toward their daily and weekly
    earnings goals"
    ([Uber driver app, CH](https://www.uber.com/ch/en/drive/driver-app/)). How a driver sets
    a goal is not documented.
  - A 2016 redesign added **progress bars toward promotions, with expiry dates**, under the
    balance, plus cash-out from the same screen
    ([refining the earnings experience](https://www.uber.com/us/en/newsroom/refining-the-earnings-experience-2/)).
- **Lyft**: a weekly earnings goal, either suggested amounts or a custom figure, which carries
  over to the next week if missed **[unverified, third-party guide]**
  ([TaxiFareFinder](https://www.taxifarefinder.com/newsroom/2023/06/08/lyft-drivers-how-to-set-lyft-goals-to-earn-more/)).
  Lyft also guarantees drivers at least 70% of rider payments each week
  ([Lyft pay](https://www.lyft.com/driver/pay)).

### 6b. Utilization: online time vs engaged time

- **Uber's two definitions.** Uber piloted an "estimated earnings per **active** hour" badge
  on trip requests. Active time counts pickup, wait and the trip itself, and leaves out idle
  online time. The pilot has ended
  ([pilot page](https://www.uber.com/us/en/blog/piloting-estimated-earnings-per-active-hour-on-trip-requests)).
  Uber's earnings estimator, by contrast, counts all online time
  ([earnings estimator FAQ](https://www.uber.com/bo/en/terms/earnings-estimator)).
- **The gap between them.** Independent analyses and drivers judge pay by **online hours**,
  which is lower. One selective driver estimated a $15–20/h gap between the two
  **[unverified, Insider via mirror]**. A UK union disputed Uber's "£30 per hour" figure
  ([Taxi Point](https://www.taxi-point.co.uk/post/drivers-aren-t-seeing-it-gmb-takes-aim-at-uber-s-30-hourly-earnings-figure-in-latest-talks)).
- **Uber's own Amsterdam data.** A quarter of drivers earned under €24.27 per online hour, and
  a quarter earned over €38.36
  ([Maastricht University](https://www.maastrichtuniversity.nl/node/45940)).
- **Historic utilization.** uberX drivers were on a trip 40% of online time (Uber, 2015), and
  New York measured 58% for Uber and Lyft in 2017 **[unverified, search summaries]**.
- **What the gap tells us.** **Third-party apps such as Gridwise exist largely to compute
  earnings per hour, per mile and per trip across platforms**, which the platforms' own
  screens do not do
  ([Gridwise earnings](https://gridwise.io/features/earnings)). The demand signal: workers want
  _per-hour on the time they actually gave_, not a figure the platform chooses.

### 6c. Lessons for a barber's view

- A session or day close-out ("you earned X in Y hours, Z clients") is the most legible unit.
  The week is the main summary unit, with a per-day bar chart.
- Itemise money into base, tips and promotions. Show late adjustments separately rather than
  silently changing a past total.
- Be explicit about which hours divide the money: online vs engaged, or scheduled vs booked.
  **Mixing them up is the main source of distrust found in this research.**

---

## 7. Revolut (presentation patterns only)

Revolut's help centre blocks fetching, so the details below come from search summaries of its
help pages **[unverified]**
([spending and income analytics](https://help.revolut.com/help/accounts/budget-and-analytics/how-can-i-see-my-spending-and-income-analytics/);
[how analytics works](https://help.revolut.com/help/app-features/budgeting-and-analytics/how-does-the-analytics-feature-work/);
[cash-flow analytics](https://help.revolut.com/help/accounts/budget-and-analytics/how-can-i-see-my-cashflow-analytics/);
[breakdown by category, merchant or country](https://help.revolut.com/en-AU/help/app-features/budgeting-and-analytics/how-can-i-see-a-spending-breakdown-by-category-or-merchant-or-country/)).

- **Breakdown and drill-down.** One hero chart sits above a list of categories. Tapping a
  category shows its transactions for the chosen period. The breakdown can switch between
  category, merchant, country and currency.
- **Period control.** Day, week, month or year. **Spending is compared with the previous
  period as a line overlaid on the current one.** Bar, pie or line charts on request.
- **Custom cycle start.** The user can start the month on payday, for example the 25th.
- **Projection.** Predicted month-end spend from daily spending and scheduled payments
  **[unverified, press report]**
  ([PaySpace](https://payspacemagazine.com/all/revolut-extends-the-functionality-of-one-of-its-features/)).
- **Budgets per category.** Notifications fire at 25, 50, 75 and 100%. Budgets are
  informational and never block spending.
- **User-correctable categories.** A user can recategorise a transaction, or "add all from
  this merchant". Custom categories are allowed.
- **Weekly spending push digest.** A community thread asks how to turn it off **[unverified,
  thread title]**
  ([Revolut community](https://community.revolut.com/t/how-to-disable-weekly-spending-info/149566)).
  Digests need an off switch.
- **Business account.** Spend by account, **team member**, category, merchant and country,
  with drill-down to transactions
  ([Revolut Business analytics](https://www.revolut.com/business/analytics/)).

---

## 8. Cross-product synthesis: where the market is thin

These are observations drawn from sections 1–7, not separately sourced.

1. **The staff member is an afterthought.** Fresha, Booksy, Square and Boulevard all build
   reports for the owner first. The barber's own view is one of the following:
   - a separate app (Square Team);
   - a cut-down wallet (Booksy Personal Wallet);
   - a report the owner sends (Booksy staff performance);
   - a permission tier that does not reach mobile (Boulevard).

   Only theCut puts the barber's numbers on the phone home screen.

2. **Raw tables, few comparisons.**
   - Boulevard users ask for period-over-period change.
   - Booksy shows change badges only in marketing mock-ups.
   - Fresha's panel offers Today, Yesterday, Week and Month with no documented "vs last".
3. **No coaching layer.** Apart from theCut's "read these metrics in pairs" help text, no
   product turns a number into "what to do next". Two points to note:
   - Benchmarks are sold separately (Phorest) or published as vendor reports (Zenoti).
   - Goals exist in gig apps (Uber, Lyft) but in none of the salon tools reviewed.
4. **Utilization is everywhere but defined inconsistently.**
   - Square: booked ÷ scheduled.
   - Boulevard: booked ÷ (scheduled − business blocks), and it can exceed 100%.
   - Vagaro: counts add-on and cleanup time as booked.
   - Booksy and Fresha: "occupancy", with no published formula.
5. **Rebooking is defined three ways.**
   - Square: next visit booked within 24 h of the appointment ending.
   - Boulevard: booked on the same day.
   - Fresha: any future appointment after the range.

   **Benchmarks are only comparable when the definition matches.**

6. **Trust breaks on attribution and reconciliation.**
   - Booksy's Boost attribution disputes.
   - Square's app and dashboard totals disagreeing.
   - Uber's online vs active hours.

   Every number needs a visible definition and a path down to the appointments behind it.

7. **Paywalls on the most useful views.** Fresha's client retention reports and Booksy's
   staff, marketing and cash-flow sections need a paid add-on or tier. Square's Team
   performance report needs Plus or Premium.

---

## 9. Metrics barbers and shop owners actually care about

Definitions and benchmarks from industry sources. Most benchmarks come from software vendors
or consultants, use different definitions, and come from North American data. **Treat them as
directional.**

The most useful single dataset found is **Zenoti's 2026 Beauty and Wellness Benchmark Report**.
It covers calendar year 2025, North American businesses on the Zenoti platform, with
undisclosed sample size, and it has a barbershop segment
([barbershop trends 2026](https://www.zenoti.com/thecheckin/barbershop-trends-2026);
[salon edition](https://www.zenoti.com/en-uk/thecheckin/the-2026-beauty-and-wellness-benchmark-report-salon-edition);
[barbershop metrics guide](https://www.zenoti.com/thecheckin/salon-and-barbershop-metrics-guide)).

| Metric                                     | Typical definition                                                           | Benchmark values found                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Utilization / occupancy / productivity** | Booked (or served) hours ÷ available hours                                   | **Barbershops: median 56%, 75th percentile 66%, top 10% 75%** (Zenoti). Salons: median 47%, top 10% 79% (Zenoti). Consultant target about 85%; below 70% means overstaffed ([Strategies](https://strategies.com/five-growth-drivers-that-can-transform-your-business))                                                                                                                                                                                    |
| **Rebooking (prebook) rate**               | Checkouts with the next visit booked before leaving ÷ checkouts              | About 90% is "rock-star" (Strategies). Target 75%+, with New Zealand averaging 52% and Australia 47% **[unverified, Kitomba blog via search]** ([Kitomba](https://www.kitomba.com/blog/?p=2701)). Zenoti, salons including barbershops: 44% of bookings not rebooked, 21% rebooked once, 35% rebooked twice or more. **First-time rebooks cancel 72% of the time; rebooked twice or more cancel 4%.** Zenoti warns that a 30-day window inflates the rate |
| **First-visit retention**                  | First-time clients who return within about 90 days ÷ first-time clients      | Below 35% is a warning, 50%+ is good, 65%+ is excellent (Strategies). Industry average "hovered at 30%" **[unverified, Behind the Chair via search]** ([BTC](https://behindthechair.com/articles/keep-your-clients-longer))                                                                                                                                                                                                                               |
| **Existing-client retention**              | Repeat clients who return within about 90 days                               | 85% is the acceptable floor (Strategies). Industry average about 70%, goal 85% **[unverified, trade interview]** ([American Salon](https://www.americansalon.com/business-career/q-a-john-harms-maximizing-referrals-rebooking-retail-sales))                                                                                                                                                                                                             |
| **Visit cadence / lapsed clients**         | Average days between visits; clients past their usual interval               | Barber clients' natural cadence is 2–5 weeks (Zenoti guide). Fresha exposes average days or weeks between appointments per client                                                                                                                                                                                                                                                                                                                         |
| **New vs returning mix**                   | Share of visits from first-time clients                                      | Barbershops: **new guest visits −17% year over year, existing +2%** (Zenoti 2025). Retention now drives growth more than acquisition                                                                                                                                                                                                                                                                                                                      |
| **Average ticket**                         | Revenue ÷ visits (whether it includes retail varies)                         | **Barbershops: median $34, 75th percentile $39, top 10% $48** (Zenoti). Salons: median $77; full-service salons median $114                                                                                                                                                                                                                                                                                                                               |
| **Revenue per hour**                       | Service revenue ÷ booked hours (or ÷ available hours)                        | No published barber benchmark found. It can be derived as average ticket × visits per hour. Gig workers judge pay this way (section 6)                                                                                                                                                                                                                                                                                                                    |
| **Tip rate**                               | Tips ÷ ticket value                                                          | **Barbershops 16–20%, the highest of any vertical** (Zenoti guide). Salons: median 12%, top 10% 18% (Zenoti)                                                                                                                                                                                                                                                                                                                                              |
| **Retail attach / retail-to-service**      | Clients buying retail ÷ service clients; or retail revenue ÷ service revenue | Salons "struggle to exceed about 10%" of gross revenue (Strategies). A 10–15% target, with most at 4–6% **[unverified]**. Barbers at 8–12% **[unverified, low-confidence source]**. Boulevard reports both "Retail Conversion %" and "Retail to Service %"                                                                                                                                                                                                |
| **No-show and cancellation rate**          | Missed (or cancelled) ÷ booked                                               | **Barbershops: no-shows 4%, cancellations 4%** (Zenoti 2025). Phorest claims a 30% average across salons and spas **[vendor claim, unverified]**. Published figures range from 3% to 30%                                                                                                                                                                                                                                                                  |
| **Online booking share**                   | Bookings made by clients online ÷ all bookings                               | Barbershops: median 36%, top 10% 68% (Zenoti)                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Requested-provider share**               | Appointments where the client asked for this barber                          | No benchmark found. Boulevard reports it as "Staff Requested %" and splits new and returning clients by it. It is a proxy for a barber's personal following                                                                                                                                                                                                                                                                                               |
| **Memberships**                            | Membership revenue share                                                     | Barbershop membership sales +20% in 2025. Salons with memberships grew sales 8% vs 2% without (Zenoti)                                                                                                                                                                                                                                                                                                                                                    |

**Suggested cadence.**

- Zenoti: track most barbershop metrics weekly, and membership share monthly. Utilization,
  rebooking and average ticket are the suggested starting metrics. It lists per-barber
  revenue, utilization, rebooking rate, retail attach and tip rate as the per-person set
  ([Zenoti guide](https://www.zenoti.com/thecheckin/salon-and-barbershop-metrics-guide)).
- Boulevard **[vendor claim]**: daily totals, weekly staff performance, monthly retention and
  average ticket
  ([Boulevard blog](https://www.joinblvd.com/blog/salon-reports)).

**Barber-specific notes.**

- Barbershop tickets are low and tightly bunched ($34 median), visits are frequent
  (2–5 weeks), tips are high, and retail is small. So for a barber:
  - **chair time and rebooking matter more than ticket size**;
  - tips are a material part of take-home pay;
  - lapsed-client detection works on a short cycle.
- Booksy's own "must-know metrics" post names six metrics (annual revenue, average booking
  value, average service price, time to booking, return rate, visit frequency) but gives no
  formulas or benchmarks
  ([Booksy metrics post](https://biz.booksy.com/en-us/blog/must-know-metrics-salon-barbershop-wellness)).
