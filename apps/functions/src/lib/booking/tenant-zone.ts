/**
 * The tenant's zone — the ONE place the functions say it.
 *
 * A single-city tenant, so a constant is honest today: the shop's calendar
 * day (the capacity horizon, the lead-time samples, a waitlist request's
 * days), the hour its nightly sweeps run at, and the zone a stored slot that
 * names none is read in. It becomes a read of the chosen
 * `Location.timezone` the day a shop opens in another zone — the same day
 * `decideBooking`'s own zone lookup stops being one shop's — and then there
 * is exactly one constant to retire.
 *
 * It lived as four local copies (the capacity rebuild, the waitlist
 * request, the lead-time sample, the policy recompute's sweep) plus a
 * scatter of `'Europe/Sofia'` fallbacks; a zone spelled in five files is
 * five files to find on that day.
 */
export const TENANT_ZONE = 'Europe/Sofia';
