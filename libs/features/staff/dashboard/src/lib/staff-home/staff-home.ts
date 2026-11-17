import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from '@angular/core';
import { ScheduleReminders } from '../schedule-reminders/schedule-reminders';
import { StaffSetupCard } from './staff-setup-card';
import { StaffWelcomeSheet } from './staff-welcome';

/**
 * THE STAFF HOME'S OWN PARTS (team onboarding D10; account first, A4–A5):
 * what the schedule says above any view before the day itself — the last
 * days to decide on, for whoever manages the team; the setup card, for a
 * barber whose profile is not done — and the welcome sheet, the first
 * time a linked barber arrives. One tag on the schedule page, whose file
 * only shrinks; a chunk of its own, fetched once the page is idle.
 */
@Component({
  selector: 'lib-staff-home',
  imports: [ScheduleReminders, StaffSetupCard, StaffWelcomeSheet],
  template: `
    <div class="staff-home__notices">
      <lib-schedule-reminders />
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
