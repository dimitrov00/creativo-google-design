import type { FirebaseEmulatorConfig } from '@creativo/infrastructure/firebase-app';

/**
 * The one shape of the web's three environment files — `environment.ts`
 * (local, against the emulators), `environment.staging.ts` and
 * `environment.production.ts`, which `fileReplacements` swap in at build
 * time (apps/web/project.json). Each declares `environment: WebEnvironment`,
 * so a field added to one and missed in another fails the build.
 *
 * What differs between them is data, not flags: which project the build
 * talks to (`firebase`), whether it talks to the emulators at all
 * (`emulators`: their addresses, or `null` in a deployed build), App Check's
 * key and the flag map.
 */
export type WebEnvironment = {
  /** Firebase's web config: public client config (it ships in the bundle), never a secret. */
  readonly firebase: {
    readonly apiKey: string;
    readonly authDomain: string;
    readonly projectId: string;
    readonly storageBucket: string;
    readonly messagingSenderId: string;
    readonly appId: string;
  };
  /** Where the local emulators answer; `null` in a deployed build, which talks to its project. */
  readonly emulators: FirebaseEmulatorConfig | null;
  /** App Check's reCAPTCHA Enterprise site key (public); `''` = not configured, nothing loads. */
  readonly appCheck: { readonly siteKey: string };
  /** The flag environment's raw map, parsed and validated by `provideFlags` at boot. */
  readonly featureFlags: Readonly<Record<string, unknown>>;
};
