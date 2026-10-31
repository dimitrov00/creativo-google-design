import { AppCheckMode, LogEvent, Tag } from '@core/primitives';
import type { AppCheckModePorts, Log } from '@core/ports';
import { APP_CHECK_MODE } from '../lib/app-check';

/**
 * The App Check switch (`AppCheckModePorts`, security hardening S-RU-19)
 * over the functions param `APP_CHECK_MODE` (`lib/app-check.ts`). Read PER
 * CALL, never at module load (the `flags.adapter.ts` rule): during deploy
 * analysis the env holds no value yet.
 *
 * Fail-open, so the switch can never lock out the current build: an unset
 * variable (`''` — every in-process run: the unit specs, `test:emulator`)
 * is OFF silently; a NON-EMPTY unknown value is OFF too, and logged ONCE
 * per instance (`edge.app_check_mode_unreadable`, the fallback mode only —
 * never the raw value), so a misconfigured deploy is visible. The env
 * writer and preflight P10 refuse an unknown value before any deploy.
 */
export const paramAppCheckModePorts = (log: Log): AppCheckModePorts => {
  let reported = false;
  return {
    appCheckMode: () => {
      const raw = APP_CHECK_MODE.value();
      if (Tag.has(AppCheckMode, raw)) return raw;
      if (raw !== '' && !reported) {
        reported = true;
        log('error', LogEvent.AppCheckModeUnreadable, {
          appCheckMode: AppCheckMode.Off,
        });
      }
      return AppCheckMode.Off;
    },
  };
};
