import { Directive, input } from '@angular/core';

export type UiForegroundStyle =
  'primary' | 'secondary' | 'accent' | 'destructive';

/** ≙ SwiftUI `.foregroundStyle(_:)` — writes `data-foreground-style`. `primary` omits the attribute (inherited color). */
@Directive({
  selector: '[uiForegroundStyle]',
  host: { '[attr.data-foreground-style]': 'attrValue()' },
})
export class UiForegroundStyleDirective {
  readonly uiForegroundStyle = input<UiForegroundStyle>('primary');

  protected attrValue(): string | null {
    const value = this.uiForegroundStyle();
    return value === 'primary' ? null : value;
  }
}
