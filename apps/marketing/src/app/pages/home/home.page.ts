import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'cr-home-page',
  imports: [],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {}
