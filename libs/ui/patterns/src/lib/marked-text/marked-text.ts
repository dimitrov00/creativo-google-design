import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

/** One run of a text: marked when it is what was typed. */
export interface UiMarkedRun {
  readonly text: string;
  readonly hit: boolean;
}

/**
 * Marked text — a text cut into runs, the typed ones washed in the accent.
 * The one look every search shares (the schedule search, the add-client rows,
 * the service catalogue): `ui-marked-text` prints the runs a system decided
 * (`TextMatchSystem`), and never decides anything itself.
 *
 * The wash is `--sys-color-mark`; the word on it stays the ink around it
 * (the accent law: colour is a shape, words are ink). The element is inline,
 * so it sits inside whatever line the host already typeset.
 *
 * Markup contract:
 * ```html
 * <span uiText uiFont="body"><ui-marked-text [uiRuns]="runs" /></span>
 * ```
 */
@Component({
  selector: 'ui-marked-text',
  // Every run is an ELEMENT, so the template's own whitespace never becomes
  // a space in the printed text (a bare text node would be padded by it).
  template: `
    @for (run of uiRuns(); track $index) {
      @if (run.hit) {
        <mark class="ui-marked-text__hit">{{ run.text }}</mark>
      } @else {
        <span>{{ run.text }}</span>
      }
    }
  `,
  styleUrl: './marked-text.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: the mark rule reaches the `<mark>` this view draws, and bare
  // `.ui-*` selectors are the system's styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ui-marked-text' },
})
export class UiMarkedText {
  /** The runs to print, in order; a run with `hit` is marked. */
  readonly uiRuns = input.required<readonly UiMarkedRun[]>();
}
