import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
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
  it('writes one PARAM=value line per flag under a generated-file header', () => {
    const text = renderEnv(map({ 'client.profile': true }), 'staging');
    expect(text.split('\n')[0]).toMatch(/^# Generated .*\(staging\)/);
    expect(parseEnv(text)).toEqual({
      CLIENT_PROFILE: 'true',
      LOYALTY_SELF_VIEW: 'false',
    });
    expect(text.endsWith('\n')).toBe(true);
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
    });
    expect(read('.env.local')).toEqual({
      CLIENT_PROFILE: 'true',
      LOYALTY_SELF_VIEW: 'true',
    });
  });

  it('agrees with the manifest value for every flag it writes', () => {
    const source = manifest();
    writeFunctionsEnv({
      manifest: source,
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
      projectId: 'demo-creativo-test',
      requested: 'production',
      outDir,
    });
    expect(read('.env.demo-creativo-test')).toEqual(read('.env.local'));
  });

  it('writes only .env.local when no project is known', () => {
    writeFunctionsEnv({ manifest: manifest(), projectId: '', outDir });
    expect(readdirSync(outDir)).toEqual(['.env.local']);
  });

  it('writes nothing when the manifest is invalid', () => {
    const bad = manifest();
    bad.production['client.profile'] = 'yes';
    expect(() =>
      writeFunctionsEnv({ manifest: bad, projectId: 'creativo-prod', outDir }),
    ).toThrow(/must be true or false/);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it('refuses to write before the functions build exists', () => {
    expect(() =>
      writeFunctionsEnv({
        manifest: manifest(),
        projectId: 'creativo-prod',
        outDir: join(outDir, 'missing'),
      }),
    ).toThrow(/run `pnpm nx build functions` first/);
  });
});
