import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'cr-dashboard-page',
  imports: [],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {}
