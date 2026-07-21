import { Directive, input } from '@angular/core';

export type UiForegroundStyle =
  'primary' | 'secondary' | 'accent' | 'destructive';

/** ≙ SwiftUI `.foregroundStyle(_:)` — writes `data-foreground`. `primary` omits the attribute (inherited color). */
@Directive({
  selector: '[uiForeground]',
  host: { '[attr.data-foreground]': 'attrValue()' },
})
export class UiForegroundDirective {
  readonly uiForeground = input<UiForegroundStyle>('primary');

  protected attrValue(): string | null {
    const value = this.uiForeground();
    return value === 'primary' ? null : value;
  }
}
