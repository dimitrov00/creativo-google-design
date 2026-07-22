import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ZonedDateTime } from '@creativo/domain/kernel';
import {
  Invitation,
  InvitationId,
  InvitationRedemption,
} from '@creativo/domain/engagement';
import { UserId } from '@creativo/domain/accounts';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { FirestoreInvitationAdapter } from './invitation.adapter';

// `vi.mock` factories are hoisted above every import — including this test
// file's own `import ... from '@creativo/infrastructure/firebase-app'`,
// which transitively loads the *real* `firebase/firestore`. Mock vars the
// factory reads must go through `vi.hoisted`, and `doc()` itself must be
// mocked too (not `importActual`'d) — the real SDK's `doc()` validates its
// first argument is a genuine `Firestore` instance, which the plain `{}`
// stand-in below is not.
const { getDocMock, setDocMock, updateDocMock } = vi.hoisted(() => ({
  getDocMock: vi.fn(),
  setDocMock: vi.fn(),
  updateDocMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({
    id: segments[segments.length - 1],
    path: segments.join('/'),
  })),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
}));

function buildInvitation(overrides?: { redemptionCount?: number }): Invitation {
  const now = ZonedDateTime.now('Europe/Sofia');
  if (now.isFailure()) throw new Error('unreachable');
  const result = Invitation.reconstitute({
    id: InvitationId.generate().value,
    inviterUserId: UserId.generate().value,
    inviterName: 'Alice',
    redemptionCount: overrides?.redemptionCount ?? 0,
    createdAt: now.value,
  });
  if (result.isFailure()) throw new Error('unreachable');
  return result.value;
}

describe('FirestoreInvitationAdapter', () => {
  let adapter: FirestoreInvitationAdapter;

  beforeEach(() => {
    getDocMock.mockReset();
    setDocMock.mockReset();
    updateDocMock.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: FIREBASE_FIRESTORE, useValue: {} },
        FirestoreInvitationAdapter,
      ],
    });
    adapter = TestBed.inject(FirestoreInvitationAdapter);
  });

  it('creates a brand-new invitation with setDoc', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    setDocMock.mockResolvedValue(undefined);

    const invitation = buildInvitation();
    const result = await adapter.save(invitation);

    expect(result.isSuccess()).toBe(true);
    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('updates only redemptionCount when the invitation already exists', async () => {
    getDocMock.mockResolvedValue({ exists: () => true });
    updateDocMock.mockResolvedValue(undefined);

    const invitation = buildInvitation({ redemptionCount: 1 });
    const result = await adapter.save(invitation);

    expect(result.isSuccess()).toBe(true);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(updateDocMock.mock.calls[0]?.[1]).toEqual({ redemptionCount: 1 });
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('returns a RepositoryError when save fails', async () => {
    getDocMock.mockRejectedValue(new Error('offline'));
    const result = await adapter.save(buildInvitation());
    expect(result.isFailure()).toBe(true);
  });

  it('findById returns null for a missing document', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    const result = await adapter.findById(InvitationId.generate());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBeNull();
    }
  });

  it('findById reconstitutes a stored invitation', async () => {
    const now = ZonedDateTime.now('Europe/Sofia');
    if (now.isFailure()) throw new Error('unreachable');
    const inviterUserId = UserId.generate().value;
    getDocMock.mockResolvedValue({
      exists: () => true,
      id: 'invitation-1',
      data: () => ({
        inviterUserId,
        inviterName: 'Alice',
        redemptionCount: 2,
        createdAt: now.value.toISO(),
      }),
    });

    const result = await adapter.findById(InvitationId.generate());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess() && result.value !== null) {
      expect(result.value.redemptionCount).toBe(2);
      expect(result.value.inviterUserId.value).toBe(inviterUserId);
    }
  });

  it('findById surfaces a malformed document as a RepositoryError', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      id: 'invitation-1',
      data: () => ({
        inviterUserId: '',
        inviterName: '',
        redemptionCount: -1,
        createdAt: 'not-iso',
      }),
    });

    const result = await adapter.findById(InvitationId.generate());
    expect(result.isFailure()).toBe(true);
  });

  it('saveRedemption writes the redemption doc', async () => {
    setDocMock.mockResolvedValue(undefined);
    const now = ZonedDateTime.now('Europe/Sofia');
    if (now.isFailure()) throw new Error('unreachable');
    const redemption = InvitationRedemption.reconstitute({
      invitationId: InvitationId.generate().value,
      refereeUserId: UserId.generate().value,
      redeemedAt: now.value,
    });
    if (redemption.isFailure()) throw new Error('unreachable');

    const result = await adapter.saveRedemption(redemption.value);
    expect(result.isSuccess()).toBe(true);
    expect(setDocMock).toHaveBeenCalledTimes(1);
  });

  it('saveRedemption surfaces a repeat-redemption rejection as a RepositoryError', async () => {
    setDocMock.mockRejectedValue(new Error('PERMISSION_DENIED'));
    const now = ZonedDateTime.now('Europe/Sofia');
    if (now.isFailure()) throw new Error('unreachable');
    const redemption = InvitationRedemption.reconstitute({
      invitationId: InvitationId.generate().value,
      refereeUserId: UserId.generate().value,
      redeemedAt: now.value,
    });
    if (redemption.isFailure()) throw new Error('unreachable');

    const result = await adapter.saveRedemption(redemption.value);
    expect(result.isFailure()).toBe(true);
  });
});
