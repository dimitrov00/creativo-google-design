/** Minimal in-memory double for the slice of Admin Auth this app uses. */
export function createFakeAuth() {
  let uidCounter = 0;
  const customTokens: Array<{ uid: string; claims?: object }> = [];

  return {
    customTokens,
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
  };
}
