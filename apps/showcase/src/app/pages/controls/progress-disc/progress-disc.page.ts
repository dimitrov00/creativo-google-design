import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  UiButton,
  UiIcon,
  UiOtpField,
  UiProgressDisc,
  type UiProgressDiscPhase,
} from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

/** The four phases, in the order an errand walks them. */
const PHASES: readonly UiProgressDiscPhase[] = [
  'idle',
  'busy',
  'acknowledged',
  'complete',
];

@Component({
  selector: 'cr-progress-disc-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiButton,
    UiFlow,
    UiIcon,
    UiOtpField,
    UiProgressDisc,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './progress-disc.page.html',
  styleUrl: './progress-disc.page.css',
})
export class ProgressDiscPage {
  protected readonly phases = PHASES;

  /** The live disc in the sign-in demo — stepped by its button. */
  protected readonly live = signal<UiProgressDiscPhase>('busy');

  protected next(): void {
    const at = PHASES.indexOf(this.live());
    this.live.set(PHASES[(at + 1) % PHASES.length] ?? 'idle');
  }
}
