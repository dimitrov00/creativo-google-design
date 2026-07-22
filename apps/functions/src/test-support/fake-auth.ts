/** Minimal in-memory double for the slice of Admin Auth this app uses. */
export function createFakeAuth() {
  let uidCounter = 0;
  const customTokens: Array<{ uid: string; claims?: object }> = [];
  const claimsByUid = new Map<string, object>();

  return {
    customTokens,
    claimsByUid,
    async createUser(properties: { email?: string; phoneNumber?: string }) {
      return { uid: `uid_${uidCounter++}`, ...properties };
    },
    async createCustomToken(
      uid: string,
      developerClaims?: object,
    ): Promise<string> {
      customTokens.push({ uid, claims: developerClaims });
      return `fake-custom-token:${uid}`;
    },
    async setCustomUserClaims(
      uid: string,
      claims: object | null,
    ): Promise<void> {
      if (claims) claimsByUid.set(uid, claims);
      else claimsByUid.delete(uid);
    },
  };
}
