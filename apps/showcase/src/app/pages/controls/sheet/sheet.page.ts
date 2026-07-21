import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiButton, UiSheet } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';

@Component({
  selector: 'cr-sheet-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButton, UiSheet, UiTextDirective],
  templateUrl: './sheet.page.html',
  styleUrl: './sheet.page.css',
})
export class SheetPage {
  protected readonly bottomOpen = signal(false);
  protected readonly centerOpen = signal(false);
  protected readonly endOpen = signal(false);
}
