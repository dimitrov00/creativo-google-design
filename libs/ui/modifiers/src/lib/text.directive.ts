import { Directive } from '@angular/core';
import { UiFontDirective } from './font.directive';
import { UiWeightDirective } from './weight.directive';
import { UiForegroundDirective } from './foreground.directive';

/**
 * ≙ SwiftUI `Text("…").font(.title).fontWeight(.bold).foregroundStyle(.accent)`
 * — bundles the common text modifiers via `hostDirectives` composition
 * instead of a monolithic typography directive; each atomic modifier still
 * writes its own `data-*` attribute independently.
 */
@Directive({
  selector: '[uiText]',
  hostDirectives: [
    { directive: UiFontDirective, inputs: ['uiFont'] },
    { directive: UiWeightDirective, inputs: ['uiWeight'] },
    { directive: UiForegroundDirective, inputs: ['uiForeground'] },
  ],
})
export class UiTextDirective {}
