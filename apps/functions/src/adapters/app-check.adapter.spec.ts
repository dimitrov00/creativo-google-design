import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppCheckMode, LogEvent } from '@core/primitives';
import type { AppCheckModePorts, Log } from '@core/ports';
import { paramAppCheckModePorts } from './app-check.adapter';

type Line = {
  readonly level: string;
  readonly msg: string;
  readonly fields: unknown;
};

function rig(): { readonly ports: AppCheckModePorts; readonly lines: Line[] } {
  const lines: Line[] = [];
  const log: Log = (level, msg, fields) => {
    lines.push({ level, msg, fields });
  };
  return { ports: paramAppCheckModePorts(log), lines };
}

describe('paramAppCheckModePorts — the App Check switch over its param (S-RU-19)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(Object.values(AppCheckMode))(
    'reads %s through as it is, logging nothing',
    (mode) => {
      vi.stubEnv('APP_CHECK_MODE', mode);
      const { ports, lines } = rig();
      expect(ports.appCheckMode()).toBe(mode);
      expect(lines).toEqual([]);
    },
  );

  it('reads an unset variable ("") as OFF, silently — every in-process run', () => {
    vi.stubEnv('APP_CHECK_MODE', '');
    const { ports, lines } = rig();
    expect(ports.appCheckMode()).toBe(AppCheckMode.Off);
    expect(ports.appCheckMode()).toBe(AppCheckMode.Off);
    expect(lines).toEqual([]);
  });

  it('reads a non-empty unknown value as OFF (fail-open) and logs ONE edge.app_check_mode_unreadable line per instance — never the raw value', () => {
    vi.stubEnv('APP_CHECK_MODE', 'enforce-sentinel');
    const { ports, lines } = rig();
    expect(ports.appCheckMode()).toBe(AppCheckMode.Off);
    expect(ports.appCheckMode()).toBe(AppCheckMode.Off);
    expect(lines).toEqual([
      {
        level: 'error',
        msg: LogEvent.AppCheckModeUnreadable,
        fields: { appCheckMode: AppCheckMode.Off },
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain('enforce-sentinel');
  });

  it('reads the deployed value at each call, never once at build', () => {
    const { ports } = rig();
    vi.stubEnv('APP_CHECK_MODE', AppCheckMode.Monitor);
    expect(ports.appCheckMode()).toBe(AppCheckMode.Monitor);
    vi.stubEnv('APP_CHECK_MODE', AppCheckMode.Enforce);
    expect(ports.appCheckMode()).toBe(AppCheckMode.Enforce);
    vi.stubEnv('APP_CHECK_MODE', '');
    expect(ports.appCheckMode()).toBe(AppCheckMode.Off);
  });
});
