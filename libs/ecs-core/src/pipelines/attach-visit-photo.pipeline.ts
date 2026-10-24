import { PhotoOrigin } from '@core/components';
import {
  type AppointmentId,
  AppointmentPhotoId,
  type BarberId,
  type CustomerId,
  MediaRefusal,
  Result,
  type UserId,
} from '@core/primitives';
import { MediaError, type RepositoryError } from '@core/errors';
import type {
  AppointmentPhoto,
  AppointmentPhotoFacts,
  PhotoObject,
} from '@core/entities';
import type {
  AppointmentPhotoPorts,
  AppointmentPhotoRecordPorts,
  ClockPorts,
  IdPorts,
} from '@core/ports';
import { MediaSystem } from '@core/systems';

/** A shutter press: the photo documents and bytes, the id source and the clock. */
export type AttachVisitPhotoPorts = AppointmentPhotoPorts &
  IdPorts &
  ClockPorts;

/** A library picture onto a visit: the photo documents (no bytes), the id source and the clock. */
export type AdoptVisitPhotoPorts = AppointmentPhotoRecordPorts &
  IdPorts &
  ClockPorts;

/** The visit a picture goes onto, and who put it there. */
export type VisitPhotoSubject = {
  readonly appointmentId: AppointmentId;
  readonly barberId: BarberId;
  /** The client record the photo shows; `null` for a guest seat with no record. */
  readonly clientCustomerId: CustomerId | null;
  readonly clientLabel: string;
  /** The signed-in account that took or adopted it — `null` when none is signed in. */
  readonly takenByUserId: UserId | null;
};

/** A shot for the visit — its picture ALREADY sized for the wire (the caller downscales first). */
export type AttachVisitPhotoCommand = VisitPhotoSubject & {
  /** The downscaled bytes — the blob the upload guard judges. */
  readonly image: Blob;
  /** The sized picture's pixels — `null` when the downscaler could not read them (stored as is). */
  readonly width: number | null;
  readonly height: number | null;
};

/** One of the shop's own pictures onto the visit — where its bytes already live, and its caption. */
export type AdoptVisitPhotoCommand = VisitPhotoSubject &
  PhotoObject & {
    readonly label: string | null;
  };

/** What a refused or failed shot answers. */
export type AttachVisitPhotoError = MediaError | RepositoryError;

/** How the picture looks and where it came from — the record's non-stamp facts. */
type PhotoLook = {
  readonly width: number | null;
  readonly height: number | null;
  readonly photoOrigin: PhotoOrigin;
  readonly label: string | null;
};

/**
 * THE ONE RECORD BUILDER both entries share (pass C, D-3): the photo's id
 * from `nextId`, then its taker, then `takenAtUtcMs = nowUtcMs` — in that
 * order, the stamps filled here from the injected id source and clock
 * (`notes-photos.port.ts`), never by the adapter.
 */
function visitPhotoFacts(
  ports: IdPorts & ClockPorts,
  subject: VisitPhotoSubject,
  look: PhotoLook,
): AppointmentPhotoFacts {
  const id = AppointmentPhotoId.of(ports.nextId());
  const takenByUserId = subject.takenByUserId;
  const takenAtUtcMs = ports.nowUtcMs();
  return {
    id,
    appointmentId: subject.appointmentId,
    barberId: subject.barberId,
    clientCustomerId: subject.clientCustomerId,
    clientLabel: subject.clientLabel,
    takenByUserId,
    takenAtUtcMs,
    width: look.width,
    height: look.height,
    photoOrigin: look.photoOrigin,
    label: look.label,
  };
}

/** The guard's neutral refusal in the visit photo's own words. */
function photoRefusal(refusal: MediaRefusal): MediaError {
  switch (refusal) {
    case MediaRefusal.NotAnImage:
      return MediaError.photoNotAnImage();
    case MediaRefusal.TooLarge:
      return MediaError.photoTooLarge(MediaSystem.PHOTO_MAX_BYTES);
  }
}

/**
 * `attachVisitPhoto` — a shutter press onto a visit (pass C, Y-2, D-10;
 * the `uploadAvatar` twin), moved out of the staff day store: the upload
 * guard FIRST (`MediaSystem.check` against `MediaSystem.PHOTO_MAX_BYTES`,
 * its refusal wrapped in `MEDIA_PHOTO_NOT_AN_IMAGE` / `MEDIA_PHOTO_TOO_LARGE`)
 * on the DOWNSCALED blob, BEFORE the id or the clock is read — a refused
 * photo uses up no id; then the record ({@link visitPhotoFacts}, a `SHOT`
 * with its size and no caption), its bytes up (`uploadPhotoBytes` derives
 * the object path from the facts), and its document written with Storage's
 * answer. The photo as written on success; the upload's `MediaError` or the
 * save's `RepositoryError` as they come.
 */
export const attachVisitPhoto =
  (ports: AttachVisitPhotoPorts) =>
  async (
    cmd: AttachVisitPhotoCommand,
  ): Promise<Result<AppointmentPhoto, AttachVisitPhotoError>> => {
    const refusal = MediaSystem.check(cmd.image, MediaSystem.PHOTO_MAX_BYTES);
    if (refusal !== null) return Result.err(photoRefusal(refusal));
    const facts = visitPhotoFacts(ports, cmd, {
      width: cmd.width,
      height: cmd.height,
      photoOrigin: PhotoOrigin.Shot,
      label: null,
    });
    const stored = await ports.uploadPhotoBytes(facts, cmd.image);
    if (!stored.ok) return stored;
    const photo: AppointmentPhoto = {
      ...facts,
      path: stored.value.path,
      url: stored.value.url,
    };
    const saved = await ports.saveAppointmentPhoto(photo);
    return saved.ok ? Result.ok(photo) : saved;
  };

/**
 * `adoptVisitPhoto` — one of the shop's own pictures onto a visit (pass C,
 * D-3): a document, no bytes and so no guard — the record from the same
 * builder ({@link visitPhotoFacts}: id, taker, stamp), a `LIBRARY` origin
 * pointing at the library object (its `path` and `url` kept as given, no
 * size, the caller's caption). The photo as written, or the save's
 * `RepositoryError`.
 */
export const adoptVisitPhoto =
  (ports: AdoptVisitPhotoPorts) =>
  async (
    cmd: AdoptVisitPhotoCommand,
  ): Promise<Result<AppointmentPhoto, RepositoryError>> => {
    const facts = visitPhotoFacts(ports, cmd, {
      width: null,
      height: null,
      photoOrigin: PhotoOrigin.Library,
      label: cmd.label,
    });
    const photo: AppointmentPhoto = { ...facts, path: cmd.path, url: cmd.url };
    const saved = await ports.saveAppointmentPhoto(photo);
    return saved.ok ? Result.ok(photo) : saved;
  };
