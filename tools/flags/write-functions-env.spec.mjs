import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppCheckMode } from '@core/primitives';
import {
  APP_CHECK_MANIFEST_PATH,
  APP_CHECK_MODES,
  APP_CHECK_PARAM,
  EMULATOR_SECRETS,
  ENVIRONMENTS,
  appCheckManifestErrors,
  appCheckModeOf,
  chooseEnvironment,
  isDemoProject,
  manifestErrors,
  paramNameOf,
  renderEnv,
  writeFunctionsEnv,
} from './write-functions-env.mjs';

const map = (overrides = {}) => ({
  'client.profile': false,
  'loyalty.selfView': false,
  ...overrides,
});
const manifest = () => ({
  development: map({ 'client.profile': true, 'loyalty.selfView': true }),
  staging: map({ 'client.profile': true }),
  production: map(),
});
/** The App Check switch per environment — the shipped shape (security hardening S-L-2). */
const appCheck = () => ({
  development: 'MONITOR',
  staging: 'OFF',
  production: 'OFF',
});

/** The subset of the Firebase CLI's dotenv grammar the writer emits. */
function parseEnv(text) {
  return Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .map((line) => line.split('=')),
  );
}

describe('paramNameOf', () => {
  it('upper-snakes dotted camelCase keys', () => {
    expect(paramNameOf('client.profile')).toBe('CLIENT_PROFILE');
    expect(paramNameOf('loyalty.selfView')).toBe('LOYALTY_SELF_VIEW');
    expect(paramNameOf('referrals.invitations')).toBe('REFERRALS_INVITATIONS');
  });
});

describe('manifestErrors', () => {
  it('accepts three maps that agree on their keys', () => {
    expect(manifestErrors(manifest())).toEqual([]);
  });

  it('names a missing or unknown environment', () => {
    const partial = manifest();
    delete partial.staging;
    expect(manifestErrors({ ...partial, qa: map() })).toEqual([
      'unknown environment "qa"',
      'missing environment "staging"',
    ]);
  });

  it('refuses a key one map lacks, in either direction', () => {
    const bad = manifest();
    delete bad.production['loyalty.selfView'];
    bad.staging['client.extra'] = false;
    expect(manifestErrors(bad)).toEqual([
      'staging: "client.extra" is missing from development',
      'production: "loyalty.selfView" is missing',
    ]);
  });

  it('refuses a string where a boolean belongs', () => {
    const bad = manifest();
    bad.staging['client.profile'] = 'true';
    expect(manifestErrors(bad)).toEqual([
      'staging: "client.profile" must be true or false',
    ]);
  });

  it('refuses a flag key that would overwrite the App Check param', () => {
    const bad = {
      development: { 'app.check.mode': false },
      staging: { 'app.check.mode': false },
      production: { 'app.check.mode': false },
    };
    expect(paramNameOf('app.check.mode')).toBe(APP_CHECK_PARAM);
    expect(manifestErrors(bad)).toContain(
      'production: "app.check.mode" maps to a reserved env name',
    );
  });

  it('refuses a key that is not dotted, or maps to a reserved env name', () => {
    const bad = {
      development: { clientProfile: false, 'firebase.config': false },
      staging: { clientProfile: false, 'firebase.config': false },
      production: { clientProfile: false, 'firebase.config': false },
    };
    const errors = manifestErrors(bad);
    expect(errors).toContain(
      'production: "clientProfile" is not a dotted flag key',
    );
    expect(errors).toContain(
      'production: "firebase.config" maps to a reserved env name',
    );
  });

  it('refuses a non-object', () => {
    expect(manifestErrors([])).toEqual(['the manifest is not a JSON object']);
  });
});

describe('chooseEnvironment', () => {
  it('gives a demo project, or none, only the development map', () => {
    expect(isDemoProject('demo-creativo-test')).toBe(true);
    expect(isDemoProject('')).toBe(true);
    expect(
      chooseEnvironment({
        projectId: 'demo-creativo-test',
        requested: 'production',
      }),
    ).toBe('development');
    expect(chooseEnvironment({ projectId: '', requested: undefined })).toBe(
      'development',
    );
  });

  it('defaults a real project to production, the map that lights last', () => {
    expect(
      chooseEnvironment({ projectId: 'creativo-prod', requested: undefined }),
    ).toBe('production');
    expect(
      chooseEnvironment({ projectId: 'creativo-prod', requested: '' }),
    ).toBe('production');
  });

  it('honours staging for a real project', () => {
    expect(
      chooseEnvironment({
        projectId: 'creativo-staging',
        requested: 'staging',
      }),
    ).toBe('staging');
  });

  it('refuses the development map or a typo for a real project', () => {
    expect(() =>
      chooseEnvironment({
        projectId: 'creativo-prod',
        requested: 'development',
      }),
    ).toThrow(/--env must be staging or production/);
    expect(() =>
      chooseEnvironment({ projectId: 'creativo-prod', requested: 'prod' }),
    ).toThrow(/got "prod"/);
  });
});

describe('renderEnv', () => {
  it('writes one PARAM=value line per flag and ONE APP_CHECK_MODE line under a generated-file header', () => {
    const text = renderEnv(map({ 'client.profile': true }), 'staging', 'OFF');
    expect(text.split('\n')[0]).toMatch(/^# Generated .*\(staging\)/);
    expect(parseEnv(text)).toEqual({
      CLIENT_PROFILE: 'true',
      LOYALTY_SELF_VIEW: 'false',
      APP_CHECK_MODE: 'OFF',
    });
    expect(text.match(/^APP_CHECK_MODE=/gm)).toHaveLength(1);
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('appCheckManifestErrors (security hardening S-RU-19)', () => {
  it('accepts exactly the three environments, each one of the three modes', () => {
    expect(appCheckManifestErrors(appCheck())).toEqual([]);
    expect(
      appCheckManifestErrors({
        development: 'ENFORCE',
        staging: 'MONITOR',
        production: 'ENFORCE',
      }),
    ).toEqual([]);
  });

  it('names an unknown or missing environment', () => {
    const partial = appCheck();
    delete partial.staging;
    expect(appCheckManifestErrors({ ...partial, qa: 'OFF' })).toEqual([
      'unknown environment "qa"',
      'missing environment "staging"',
    ]);
  });

  it('refuses a mode that is not one of the three — a lower-case spelling, a boolean, an empty string', () => {
    for (const bad of ['monitor', true, '', null, 'ENFORCED']) {
      expect(
        appCheckManifestErrors({ ...appCheck(), production: bad }),
        String(bad),
      ).toEqual(['production: must be one of OFF, MONITOR, ENFORCE']);
    }
  });

  it('refuses a non-object', () => {
    for (const bad of [[], null, 'OFF']) {
      expect(appCheckManifestErrors(bad)).toEqual([
        'the manifest is not a JSON object',
      ]);
    }
  });

  it('spells the modes exactly as the AppCheckMode dictionary does', () => {
    expect([...APP_CHECK_MODES]).toEqual(Object.values(AppCheckMode));
  });
});

describe('appCheckModeOf (security hardening S-L-2)', () => {
  it('gives the chosen environment’s mode when no override is given', () => {
    for (const environment of ENVIRONMENTS) {
      for (const override of [undefined, '']) {
        expect(
          appCheckModeOf({
            manifest: appCheck(),
            environment,
            override,
            projectId: 'creativo-prod',
          }),
        ).toBe(appCheck()[environment]);
      }
    }
  });

  it('honours an override for a demo-* project', () => {
    for (const override of APP_CHECK_MODES) {
      expect(
        appCheckModeOf({
          manifest: appCheck(),
          environment: 'development',
          override,
          projectId: 'demo-creativo-test',
        }),
      ).toBe(override);
    }
  });

  it('refuses an override for a real project — or none — with exit code 2', () => {
    for (const projectId of ['creativo-prod', '', undefined]) {
      let thrown;
      try {
        appCheckModeOf({
          manifest: appCheck(),
          environment: 'production',
          override: 'ENFORCE',
          projectId,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown?.message, String(projectId)).toMatch(
        /for a demo-\* project only/,
      );
      expect(thrown?.exitCode).toBe(2);
    }
  });

  it('refuses an override that is not a mode', () => {
    expect(() =>
      appCheckModeOf({
        manifest: appCheck(),
        environment: 'development',
        override: 'enforce',
        projectId: 'demo-creativo-test',
      }),
    ).toThrow(/must be one of OFF, MONITOR, ENFORCE \(got "enforce"\)/);
  });
});

describe('config/app-check.json — the shipped switch', () => {
  const shipped = JSON.parse(readFileSync(APP_CHECK_MANIFEST_PATH, 'utf8'));

  it('passes the writer', () => {
    expect(appCheckManifestErrors(shipped)).toEqual([]);
  });

  it('ships MONITOR for development (every emulator journey verifies and tags) and OFF for staging and production', () => {
    expect(shipped).toEqual({
      development: 'MONITOR',
      staging: 'OFF',
      production: 'OFF',
    });
  });
});

describe('writeFunctionsEnv', () => {
  let outDir;
  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'creativo-flags-'));
  });
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });
  const read = (name) => parseEnv(readFileSync(join(outDir, name), 'utf8'));

  it('writes the chosen map for the project and the development map for the emulators', () => {
    const result = writeFunctionsEnv({
      manifest: manifest(),
      appCheckManifest: appCheck(),
      projectId: 'creativo-staging',
      requested: 'staging',
      outDir,
    });
    expect(result.environment).toBe('staging');
    expect(readdirSync(outDir).sort()).toEqual([
      '.env.creativo-staging',
      '.env.local',
    ]);
    expect(read('.env.creativo-staging')).toEqual({
      CLIENT_PROFILE: 'true',
      LOYALTY_SELF_VIEW: 'false',
      APP_CHECK_MODE: 'OFF',
    });
    expect(read('.env.local')).toEqual({
      CLIENT_PROFILE: 'true',
      LOYALTY_SELF_VIEW: 'true',
      APP_CHECK_MODE: 'MONITOR',
    });
  });

  it('agrees with the manifest value for every flag it writes', () => {
    const source = manifest();
    writeFunctionsEnv({
      manifest: source,
      appCheckManifest: appCheck(),
      projectId: 'creativo-prod',
      requested: undefined,
      outDir,
    });
    const written = read('.env.creativo-prod');
    for (const [key, value] of Object.entries(source.production)) {
      expect(written[paramNameOf(key)]).toBe(String(value));
    }
  });

  it('gives a demo project the development map', () => {
    writeFunctionsEnv({
      manifest: manifest(),
      appCheckManifest: appCheck(),
      projectId: 'demo-creativo-test',
      requested: 'production',
      outDir,
    });
    expect(read('.env.demo-creativo-test')).toEqual(read('.env.local'));
  });

  it('gives a demo project the emulator’s TEST secrets — the walk-in key (OR-26) and the log digest key (WS-4.2) among them', () => {
    const result = writeFunctionsEnv({
      manifest: manifest(),
      appCheckManifest: appCheck(),
      projectId: 'demo-creativo-test',
      outDir,
    });
    expect(readdirSync(outDir).sort()).toEqual([
      '.env.demo-creativo-test',
      '.env.local',
      '.secret.local',
    ]);
    expect(result.files).toContain(join(outDir, '.secret.local'));
    expect(read('.secret.local')).toEqual(EMULATOR_SECRETS);
    expect(read('.secret.local')['WALKIN_ID_KEY']).toMatch(/\S/);
    expect(read('.secret.local')['LOG_DIGEST_KEY']).toMatch(/\S/);
    expect(Object.keys(EMULATOR_SECRETS).sort()).toEqual([
      'LOG_DIGEST_KEY',
      'WALKIN_ID_KEY',
    ]);
  });

  it('never writes the TEST secrets beside a real project’s build', () => {
    writeFunctionsEnv({
      manifest: manifest(),
      appCheckManifest: appCheck(),
      projectId: 'creativo-prod',
      outDir,
    });
    expect(readdirSync(outDir)).not.toContain('.secret.local');
  });

  it('writes only .env.local when no project is known', () => {
    writeFunctionsEnv({
      manifest: manifest(),
      appCheckManifest: appCheck(),
      projectId: '',
      outDir,
    });
    expect(readdirSync(outDir)).toEqual(['.env.local']);
  });

  it('writes nothing when the manifest is invalid', () => {
    const bad = manifest();
    bad.production['client.profile'] = 'yes';
    expect(() =>
      writeFunctionsEnv({
        manifest: bad,
        appCheckManifest: appCheck(),
        projectId: 'creativo-prod',
        outDir,
      }),
    ).toThrow(/must be true or false/);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it('writes the development map’s MONITOR to both files of a demo project (S-DEP-12)', () => {
    const result = writeFunctionsEnv({
      manifest: manifest(),
      appCheckManifest: appCheck(),
      projectId: 'demo-creativo-test',
      outDir,
    });
    expect(result.appCheckMode).toBe('MONITOR');
    expect(read('.env.demo-creativo-test')[APP_CHECK_PARAM]).toBe('MONITOR');
    expect(read('.env.local')[APP_CHECK_PARAM]).toBe('MONITOR');
  });

  it('writes a real project’s own environment mode to its file, the development mode to .env.local', () => {
    const result = writeFunctionsEnv({
      manifest: manifest(),
      appCheckManifest: { ...appCheck(), production: 'ENFORCE' },
      projectId: 'creativo-prod',
      outDir,
    });
    expect(result.appCheckMode).toBe('ENFORCE');
    expect(read('.env.creativo-prod')[APP_CHECK_PARAM]).toBe('ENFORCE');
    expect(read('.env.local')[APP_CHECK_PARAM]).toBe('MONITOR');
  });

  it('lands a demo project’s override in BOTH files — the emulator loads .env.local last (S-L-2)', () => {
    for (const override of APP_CHECK_MODES) {
      const result = writeFunctionsEnv({
        manifest: manifest(),
        appCheckManifest: appCheck(),
        appCheckOverride: override,
        projectId: 'demo-creativo-test',
        outDir,
      });
      expect(result.appCheckMode).toBe(override);
      expect(read('.env.demo-creativo-test')[APP_CHECK_PARAM]).toBe(override);
      expect(read('.env.local')[APP_CHECK_PARAM]).toBe(override);
    }
  });

  it('writes nothing when an override names a real project, or the App Check manifest is invalid', () => {
    expect(() =>
      writeFunctionsEnv({
        manifest: manifest(),
        appCheckManifest: appCheck(),
        appCheckOverride: 'ENFORCE',
        projectId: 'creativo-prod',
        outDir,
      }),
    ).toThrow(/for a demo-\* project only/);
    expect(() =>
      writeFunctionsEnv({
        manifest: manifest(),
        appCheckManifest: { ...appCheck(), staging: 'on' },
        projectId: 'creativo-staging',
        requested: 'staging',
        outDir,
      }),
    ).toThrow(/config\/app-check\.json: staging: must be one of/);
    expect(() =>
      writeFunctionsEnv({
        manifest: manifest(),
        projectId: 'creativo-prod',
        outDir,
      }),
    ).toThrow(/config\/app-check\.json: the manifest is not a JSON object/);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it('refuses to write before the functions build exists', () => {
    expect(() =>
      writeFunctionsEnv({
        manifest: manifest(),
        appCheckManifest: appCheck(),
        projectId: 'creativo-prod',
        outDir: join(outDir, 'missing'),
      }),
    ).toThrow(/run `pnpm nx build functions` first/);
  });
});
