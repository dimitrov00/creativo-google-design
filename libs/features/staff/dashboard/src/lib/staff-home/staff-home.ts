import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from '@angular/core';
import { StaffSetupCard } from './staff-setup-card';
import { StaffWelcomeSheet } from './staff-welcome';

/**
 * THE STAFF HOME'S OWN PARTS (account first, A4–A5): what the schedule says
 * above any view before the day itself — the setup card, for a barber
 * whose profile is not done — and the welcome sheet, the first time a
 * linked barber arrives. One tag on the schedule page, whose file only
 * shrinks; a chunk of its own, fetched once the page is idle.
 *
 * The team's last days to decide on stood here too, until the owner's
 * ruling of 2026-11-25 (Q2): they are on top of «Анализи» now
 * (`lib-analytics-reminders`), and the schedule counts them on the chart
 * button's badge (`AnalyticsEntry.pending`), which moves nothing.
 */
@Component({
  selector: 'lib-staff-home',
  imports: [StaffSetupCard, StaffWelcomeSheet],
  template: `
    <div class="staff-home__notices">
      <lib-staff-setup-card />
    </div>
    <lib-staff-welcome />
  `,
  styleUrl: './staff-home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'staff-home', '[attr.data-testid]': '"staff-home"' },
})
export class StaffHome {}
