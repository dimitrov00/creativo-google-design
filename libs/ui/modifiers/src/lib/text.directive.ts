import { Directive } from '@angular/core';
import { UiFontDirective } from './font.directive';
import { UiWeightDirective } from './weight.directive';
import { UiForegroundStyleDirective } from './foreground.directive';

/**
 * ≙ SwiftUI `Text("…").font(.title).fontWeight(.bold).foregroundStyle(.accent)`
 * — bundles the common text modifiers via `hostDirectives` composition
 * instead of a monolithic typography directive; each atomic modifier still
 * writes its own `data-*` attribute independently.
 *
 * @uiPurpose Sets font, weight and colour on a piece of text in one attribute.
 * @uiSwiftUI `Text` with `.font(_:)`, `.fontWeight(_:)` and
 *   `.foregroundStyle(_:)`
 * @uiAliases text, typography, label, heading, paragraph
 */
@Directive({
  selector: '[uiText]',
  hostDirectives: [
    { directive: UiFontDirective, inputs: ['uiFont'] },
    { directive: UiWeightDirective, inputs: ['uiWeight'] },
    { directive: UiForegroundStyleDirective, inputs: ['uiForegroundStyle'] },
  ],
})
export class UiTextDirective {}
