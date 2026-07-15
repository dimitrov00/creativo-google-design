import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CursorTargetDirective } from '@creativo/shared/cursor';
import { Button } from '@creativo/shared/ui';

@Component({
  selector: 'cr-cursor-playground-page',
  imports: [Button, CursorTargetDirective],
  templateUrl: './cursor-playground.page.html',
  styleUrl: './cursor-playground.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CursorPlaygroundPage {
  protected readonly denseGrid = Array.from({ length: 24 }, (_, i) => i);
}
