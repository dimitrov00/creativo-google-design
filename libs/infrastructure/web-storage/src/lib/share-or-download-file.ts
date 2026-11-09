/** What became of a file handed to {@link shareOrDownloadFile}. */
export const FileHandoff = {
  /** The device's share sheet took it. */
  Shared: 'SHARED',
  /** The browser saved it through a download link. */
  Downloaded: 'DOWNLOADED',
  /** The person closed the share sheet without picking a target. */
  Cancelled: 'CANCELLED',
} as const;
export type FileHandoff = (typeof FileHandoff)[keyof typeof FileHandoff];

/**
 * The browser the helper reaches — the page's own `window` by default; a
 * spec hands a stand-in. Only what the helper touches.
 */
export type FileHandoffHost = {
  readonly navigator: Navigator;
  readonly document: Document;
};

/**
 * THE APP'S ONE WAY TO GIVE A PERSON A FILE (staff analytics v2,
 * «Export (PR 7)»): the device's share sheet where it can take files — a
 * phone, where «Запази във Файлове», AirDrop and a messenger are what a
 * person reaches for — and a plain `<a download>` everywhere else.
 *
 * - The share sheet is offered only when `navigator.share` exists and
 *   `navigator.canShare({ files })` admits this file; the file is
 *   `new File([blob], name, { type: blob.type })`.
 * - Closing the sheet (`AbortError`) is `CANCELLED`: the person chose not
 *   to, and no download follows behind their back.
 * - Any other refusal — a lost user activation after an `await`
 *   (`NotAllowedError`), a type the platform will not share — falls back
 *   to the download, so the file always arrives.
 * - The download link's object URL is freed on the next turn of the loop:
 *   revoking synchronously races the click the browser is still handling.
 *
 * No port and no token: a browser download has no domain meaning. Call it
 * from the click handler itself, before any `await`, so the share sheet
 * still has the tap's user activation.
 */
export async function shareOrDownloadFile(
  name: string,
  blob: Blob,
  host: FileHandoffHost = window,
): Promise<FileHandoff> {
  const { navigator } = host;
  if (
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return FileHandoff.Shared;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return FileHandoff.Cancelled;
        }
        // Any other refusal: the download below.
      }
    }
  }
  download(name, blob, host.document);
  return FileHandoff.Downloaded;
}

function download(name: string, blob: Blob, document: Document): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
