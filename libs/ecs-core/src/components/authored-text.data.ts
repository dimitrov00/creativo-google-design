import { StoredFields } from '@core/primitives';

/**
 * Display text as an editor AUTHORS it — not a stored `LocalizedText`,
 * whose two languages are both required: Bulgarian, and English when the
 * author gave one. A blank English is saved as the Bulgarian text (team
 * onboarding D5, O5), so nobody has to write in two languages.
 */
export type AuthoredText = {
  readonly bg: string;
  readonly en: string | null;
};

export const AuthoredText = {
  /**
   * The edge guard for an untrusted value (a callable payload's field): an
   * object whose `bg` is a string and whose `en` is a string, `null` or
   * absent (read as `null`) — else `null`. Whether the text is usable
   * (blank, too long) is the system's question, not the wire's.
   */
  read(raw: unknown): AuthoredText | null {
    if (!StoredFields.isRecord(raw)) return null;
    const bg = raw['bg'];
    const en = raw['en'] ?? null;
    return typeof bg === 'string' && (en === null || typeof en === 'string')
      ? { bg, en }
      : null;
  },
} as const;
