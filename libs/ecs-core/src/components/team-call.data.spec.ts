import { describe, expect, it } from 'vitest';
import { PipelineErrorCode } from '@core/errors';
import { BarberId } from '@core/primitives';
import { unwrapErr, unwrapOk } from '@core/testing';
import { BarberActivation } from './barber-activation.data';
import { StaffSetupItem } from './staff-setup-item.data';
import { BarberEdit, TeamCall } from './team-call.data';

const IVAN = BarberId.of('ivan');

describe('BarberEdit — which part of a record `editBarber` replaces', () => {
  it('names the five editors, SCREAMING_SNAKE, each once', () => {
    expect(BarberEdit).toEqual({
      Profile: 'PROFILE',
      Shops: 'SHOPS',
      Period: 'PERIOD',
      Pool: 'POOL',
      Access: 'ACCESS',
    });
  });
});

describe('TeamCall.decodeSaved — the record a call wrote', () => {
  it('reads the record’s id, and nothing else', () => {
    expect(
      unwrapOk(TeamCall.decodeSaved({ barberId: 'ivan', stray: true })),
    ).toEqual({ barberId: IVAN });
  });

  it('refuses an answer with nothing usable in it as PIPELINE_UNKNOWN', () => {
    for (const raw of [
      null,
      'ivan',
      [],
      {},
      { barberId: 7 },
      { barberId: '' },
    ]) {
      expect(
        unwrapErr(TeamCall.decodeSaved(raw)).errorCode,
        JSON.stringify(raw),
      ).toBe(PipelineErrorCode.Unknown);
    }
  });
});

describe('TeamCall.decodeActivation — what the go-live step came to', () => {
  it('reads an activation and an unchanged record', () => {
    expect(
      unwrapOk(
        TeamCall.decodeActivation({
          barberId: 'ivan',
          barberActivation: 'ACTIVATED',
        }),
      ),
    ).toEqual({ barberId: IVAN, barberActivation: BarberActivation.Activated });
    expect(
      unwrapOk(
        TeamCall.decodeActivation({
          barberId: 'ivan',
          barberActivation: 'UNCHANGED',
          // Beside any answer but NOT_READY a sent item is not read.
          staffSetupItem: 'HOURS',
        }),
      ),
    ).toEqual({ barberId: IVAN, barberActivation: BarberActivation.Unchanged });
  });

  it('reads a record that is not ready with the first item it misses', () => {
    expect(
      unwrapOk(
        TeamCall.decodeActivation({
          barberId: 'ivan',
          barberActivation: 'NOT_READY',
          staffSetupItem: 'HOURS',
        }),
      ),
    ).toEqual({
      barberId: IVAN,
      barberActivation: BarberActivation.NotReady,
      staffSetupItem: StaffSetupItem.Hours,
    });
  });

  it('refuses an unknown answer, and a NOT_READY that names no item', () => {
    for (const raw of [
      null,
      {},
      { barberId: 'ivan' },
      { barberActivation: 'ACTIVATED' },
      { barberId: 'ivan', barberActivation: 'LIVE' },
      { barberId: 'ivan', barberActivation: 'NOT_READY' },
      { barberId: 'ivan', barberActivation: 'NOT_READY', staffSetupItem: 'X' },
    ]) {
      expect(
        unwrapErr(TeamCall.decodeActivation(raw)).errorCode,
        JSON.stringify(raw),
      ).toBe(PipelineErrorCode.Unknown);
    }
  });
});
