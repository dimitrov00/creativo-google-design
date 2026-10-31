import { describe, expect, it } from 'vitest';
import {
  RULES_CODE as CODE,
  blockOf,
  occurrences,
} from '../testing/rules-text';

/*
 * The stamp window of `firestore.rules` as TEXT (audit hardening WS-3.4,
 * DEP-15, RU-18). The emulator suite proves the window's behaviour against
 * the emulator's own clock, which no spec can pin; this pure spec pins what
 * that suite cannot: the helper's exact body, the one `300000` (±300 s)
 * literal, the one `request.time` read, and its two call sites — the
 * note's `writtenAtUtcMs` and the photo's `takenAtUtcMs`, each beside the
 * author check — so the window can neither widen nor wander onto a
 * shop-time coordinate (`utcEpochMs`, Law 7.3) unnoticed.
 */

/** Whitespace folded to one space — the rules' own layout is not the pin. */
const folded = (text: string): string => text.replace(/\s+/g, ' ').trim();

describe('firestore.rules — the stamp window (WS-3.4, DEP-15)', () => {
  it('declares stampInWindow once: an integer within 300000 ms of request.time', () => {
    expect(folded(CODE)).toContain(
      'function stampInWindow(ms) { return ms is int && math.abs(ms - request.time.toMillis()) <= 300000; }',
    );
    expect(occurrences(CODE, 'function stampInWindow(')).toBe(1);
  });

  it('holds the 300000 literal and the request.time read inside the helper only', () => {
    expect(occurrences(CODE, '300000')).toBe(1);
    expect(occurrences(CODE, 'request.time')).toBe(1);
  });

  it('calls the helper exactly twice: the note’s writtenAtUtcMs and the photo’s takenAtUtcMs', () => {
    expect(occurrences(CODE, 'stampInWindow(')).toBe(3);
    expect(
      occurrences(CODE, 'stampInWindow(request.resource.data.writtenAtUtcMs)'),
    ).toBe(1);
    expect(
      occurrences(CODE, 'stampInWindow(request.resource.data.takenAtUtcMs)'),
    ).toBe(1);
    expect(CODE).not.toMatch(/stampInWindow\([^)]*utcEpochMs/);
  });

  it('windows a note’s create and update beside its author, and leaves its delete to the book', () => {
    const notes = folded(blockOf('/appointmentNotes/{appointmentId}'));
    // Security hardening S-DEP-5 (S-RU-8): the id proof and the key list
    // follow the window — the author check and the one stamp stay first.
    expect(notes).toContain(
      "allow create, update: if worksTheBook() && request.resource.data.authorUserId == request.auth.uid && stampInWindow(request.resource.data.writtenAtUtcMs) && request.resource.data.keys().hasOnly(['authorUserId', 'text', 'writtenAtUtcMs']) && exists(/databases/$(database)/documents/appointments/$(appointmentId));",
    );
    expect(notes).toContain('allow read: if worksTheBook();');
    expect(notes).toContain('allow delete: if worksTheBook();');
    expect(notes).not.toContain('write:');
  });

  it('windows a photo’s create beside its taker, refuses every update, and leaves its delete to the book', () => {
    const photos = folded(blockOf('/appointmentPhotos/{photoId}'));
    // Security hardening S-DEP-5 (S-RU-8): the id proofs, the key list and
    // the origin / path pins follow the window — the taker check and the one
    // stamp stay first.
    expect(photos).toContain(
      "allow create: if worksTheBook() && request.resource.data.takenByUserId == request.auth.uid && stampInWindow(request.resource.data.takenAtUtcMs) && photoId.matches('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') && request.resource.data.keys().hasOnly(['appointmentId', 'barberId', 'clientCustomerId', 'clientLabel', 'height', 'label', 'path', 'photoOrigin', 'takenAtUtcMs', 'takenByUserId', 'url', 'width']) && request.resource.data.appointmentId is string && request.resource.data.photoOrigin in ['SHOT', 'LIBRARY'] && (request.resource.data.photoOrigin != 'SHOT' || request.resource.data.path == 'appointmentPhotos/' + request.resource.data.appointmentId + '/' + photoId) && exists(/databases/$(database)/documents/appointments/$(request.resource.data.appointmentId));",
    );
    expect(photos).toContain('allow read: if worksTheBook();');
    expect(photos).toContain('allow update: if false;');
    expect(photos).toContain('allow delete: if worksTheBook();');
    expect(photos).not.toContain('write:');
  });
});
