import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'cr-bookings-page',
  imports: [],
  templateUrl: './bookings.page.html',
  styleUrl: './bookings.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookingsPage {}
