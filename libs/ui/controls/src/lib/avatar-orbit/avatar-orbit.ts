import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from '@angular/core';
import { UiAvatar } from '../avatar/avatar';

/** One face in an orbit: who, and their picture (`null` draws the monogram). */
export type UiAvatarOrbitFace = {
  readonly id: string;
  readonly name: string;
  readonly avatarSrc: string | null;
};

/**
 * The seats around the centre: three on the inner orbit, three on the outer,
 * sixty degrees apart and alternating, so any count from one to six sits
 * balanced. Past six, the last seat is the count.
 */
const SEATS = 6;
/** The inner orbit's seats draw the larger face. */
const INNER_SEATS = 3;

/**
 * THE AVATAR ORBIT — one person at the centre, the people around them
 * turning slowly on two faint orbits (2026-11-17; owner: "like in Apple
 * iMessage … the avatars kinda orbiting"). Messages' group header gathers
 * its people as a cluster of discs of different sizes around the
 * conversation; Polarsteps and Orbit put a face at the centre of rings. A
 * welcome into a team is that picture: the newcomer in the middle, ringed
 * in the accent, the colleagues around them.
 *
 * - **Seats.** Up to six faces, the first three larger on the inner orbit;
 *   more than six are five faces and a «+N» in the last seat.
 * - **Motion.** The faces arrive from the centre, one after another, a ring
 *   pulses once from the centre face, then the orbits turn — one turn every
 *   two minutes, each face counter-turning so it stays upright. Transform
 *   only, on the compositor. With reduced motion, a still picture.
 * - **Ground.** Each face is cut out of the orbit line by a ring of the
 *   ground it sits on (`--ui-avatar-orbit-ground`, the surface unless the
 *   consumer says otherwise).
 * - **One mark.** `role="img"` named by the consumer's `aria-label`
 *   (everyone it stands for); the discs are decoration.
 *
 * @uiPurpose A hero picture of one person at the centre with up to six others
 *   turning slowly around them.
 * @uiSwiftUI none
 * @uiAliases avatar orbit, team hero, people cluster, welcome picture,
 *   orbiting avatars
 * @uiNotThis A compact row of people is `ui-avatar-group`.
 */
@Component({
  selector: 'ui-avatar-orbit',
  imports: [UiAvatar],
  template: `
    <span class="ui-avatar-orbit__paths" aria-hidden="true"></span>
    <span class="ui-avatar-orbit__pulse" aria-hidden="true"></span>
    <span class="ui-avatar-orbit__ring" aria-hidden="true">
      @for (face of seated(); track face.id; let i = $index) {
        <ui-avatar
          class="ui-avatar-orbit__seat"
          [attr.data-seat]="i + 1"
          [uiControlSize]="i < innerSeats ? 'large' : 'regular'"
          [uiSrc]="face.avatarSrc"
          [uiName]="face.name"
        />
      }
      @if (overflow() > 0) {
        <span
          class="ui-avatar-orbit__seat ui-avatar-orbit__more"
          [attr.data-seat]="seated().length + 1"
          >+{{ overflow() }}</span
        >
      }
    </span>
    <ui-avatar
      class="ui-avatar-orbit__center"
      uiControlSize="extraLarge"
      aria-hidden="true"
      [uiSrc]="uiCenter().avatarSrc"
      [uiName]="uiCenter().name"
    />
  `,
  styleUrl: './avatar-orbit.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, like every `ui-*` element (see avatar.ts): the global `.ui-*`
  // classes are the system's styling contract, and emulated encapsulation
  // never matches a component's own host.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-avatar-orbit',
    role: 'img',
  },
})
export class UiAvatarOrbit {
  /** The person at the centre. */
  readonly uiCenter = input.required<UiAvatarOrbitFace>();
  /** The people around them, in order; past six, a count. */
  readonly uiFaces = input<readonly UiAvatarOrbitFace[]>([]);

  protected readonly innerSeats = INNER_SEATS;

  /** The faces given a seat: all of them up to six, else five and the count. */
  protected readonly seated = computed(() => {
    const faces = this.uiFaces();
    return faces.length <= SEATS ? faces : faces.slice(0, SEATS - 1);
  });

  /** The faces past the seats, drawn as «+N» in the last one. */
  protected readonly overflow = computed(
    () => this.uiFaces().length - this.seated().length,
  );
}
