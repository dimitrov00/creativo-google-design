import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FileHandoff,
  type FileHandoffHost,
  shareOrDownloadFile,
} from './share-or-download-file';

const BLOB = new Blob(['вид;бръснар\r\n'], { type: 'text/csv;charset=utf-8' });
const NAME = 'creativo-analytics-2026-11-01-2026-11-30.csv';

type Clicked = { readonly href: string; readonly download: string };

/** The page's document with every link click recorded instead of followed. */
function recordingDocument(): { document: Document; clicked: Clicked[] } {
  const clicked: Clicked[] = [];
  const real = window.document;
  const document = {
    createElement: (tag: string) => {
      const element = real.createElement(tag) as HTMLAnchorElement;
      element.click = () =>
        clicked.push({ href: element.href, download: element.download });
      return element;
    },
  } as unknown as Document;
  return { document, clicked };
}

/** A navigator with the share sheet the spec scripts; `share: null` is a browser without one. */
function hostWith(options: {
  readonly share: ((data: ShareData) => Promise<void>) | null;
  readonly canShare?: (data: ShareData) => boolean;
}): { host: FileHandoffHost; clicked: Clicked[]; shared: ShareData[] } {
  const shared: ShareData[] = [];
  const { document, clicked } = recordingDocument();
  const navigator = {
    share:
      options.share === null
        ? undefined
        : (data: ShareData) => {
            shared.push(data);
            return (options.share as (d: ShareData) => Promise<void>)(data);
          },
    canShare:
      options.share === null ? undefined : (options.canShare ?? (() => true)),
  } as unknown as Navigator;
  return { host: { navigator, document }, clicked, shared };
}

/** A file's text — jsdom's `File` has no `text()`; `FileReader` it has. */
function textOf(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:creativo/1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('shareOrDownloadFile', () => {
  it('hands the file to the share sheet where the device takes files', async () => {
    const { host, shared, clicked } = hostWith({
      share: async () => undefined,
    });
    await expect(shareOrDownloadFile(NAME, BLOB, host)).resolves.toBe(
      FileHandoff.Shared,
    );
    expect(shared).toHaveLength(1);
    const file = shared[0]?.files?.[0] as File;
    expect(file.name).toBe(NAME);
    expect(file.type).toBe('text/csv;charset=utf-8');
    expect(await textOf(file)).toBe('вид;бръснар\r\n');
    expect(clicked).toEqual([]);
  });

  it('a closed share sheet is CANCELLED, and nothing downloads behind it', async () => {
    const { host, clicked } = hostWith({
      share: async () => {
        throw new DOMException('Share canceled', 'AbortError');
      },
    });
    await expect(shareOrDownloadFile(NAME, BLOB, host)).resolves.toBe(
      FileHandoff.Cancelled,
    );
    expect(clicked).toEqual([]);
  });

  it('any other refusal of the sheet downloads the file instead', async () => {
    const { host, clicked } = hostWith({
      share: async () => {
        throw new DOMException('No user activation', 'NotAllowedError');
      },
    });
    await expect(shareOrDownloadFile(NAME, BLOB, host)).resolves.toBe(
      FileHandoff.Downloaded,
    );
    expect(clicked).toEqual([{ href: 'blob:creativo/1', download: NAME }]);
  });

  it('a file the sheet will not take, or a browser without one, downloads through a link and frees its URL on the next turn', async () => {
    const refused = hostWith({
      share: async () => undefined,
      canShare: () => false,
    });
    await expect(shareOrDownloadFile(NAME, BLOB, refused.host)).resolves.toBe(
      FileHandoff.Downloaded,
    );
    expect(refused.shared).toEqual([]);
    expect(refused.clicked).toHaveLength(1);

    const none = hostWith({ share: null });
    await expect(shareOrDownloadFile(NAME, BLOB, none.host)).resolves.toBe(
      FileHandoff.Downloaded,
    );
    expect(none.clicked).toEqual([{ href: 'blob:creativo/1', download: NAME }]);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:creativo/1');
  });
});
