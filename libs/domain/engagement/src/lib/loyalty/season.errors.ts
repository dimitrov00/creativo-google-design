import { DomainError } from '@creativo/domain/kernel';
import type { LocalizedTextFieldEmptyError } from '@creativo/domain/catalog';
import type { EmptyIdError } from '../ids.errors';

/** Both ends are Europe/Sofia days, `YYYY-MM-DD`. */
export class SeasonWindowMalformedError extends DomainError {
  override readonly code = 'engagement.season.window_malformed' as const;
  constructor(
    public readonly from: string,
    public readonly until: string,
  ) {
    super(`A season's window must be two calendar days: ${from} – ${until}`, {
      from,
      until,
    });
  }
}

export class SeasonWindowInvertedError extends DomainError {
  override readonly code = 'engagement.season.window_inverted' as const;
  constructor(
    public readonly from: string,
    public readonly until: string,
  ) {
    super(`A season cannot end before it starts: ${from} – ${until}`, {
      from,
      until,
    });
  }
}

/** An event is a short window of its own families; only a season has a track. */
export class SeasonEventWithTrackError extends DomainError {
  override readonly code = 'engagement.season.event_with_track' as const;
  constructor() {
    super('An event has no track family');
  }
}

export class SeasonWithoutTrackError extends DomainError {
  override readonly code = 'engagement.season.without_track' as const;
  constructor() {
    super('A season needs a track family');
  }
}

/** A season changes what earns, so it is announced a notice period ahead (R29). */
export class SeasonAnnouncedLateError extends DomainError {
  override readonly code = 'engagement.season.announced_late' as const;
  constructor(
    public readonly announcedOn: string,
    public readonly from: string,
    public readonly noticeDays: number,
  ) {
    super(
      `A season starting ${from} must be announced ${noticeDays} days ahead, not on ${announcedOn}`,
      { announcedOn, from, noticeDays },
    );
  }
}

export type SeasonError =
  | EmptyIdError
  | LocalizedTextFieldEmptyError
  | SeasonWindowMalformedError
  | SeasonWindowInvertedError
  | SeasonEventWithTrackError
  | SeasonWithoutTrackError
  | SeasonAnnouncedLateError;
