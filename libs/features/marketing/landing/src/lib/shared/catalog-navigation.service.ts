import { Injectable, signal } from '@angular/core';
import type { ServiceVm } from '../content/landing-content';

/**
 * Which service the landing's detail sheet is showing, if any.
 *
 * Deliberately NOT a navigation stack. Following a reference inside the
 * sheet — a bundle member, a row in a barber's price list — REOPENS the
 * sheet on the new subject rather than pushing a level onto a history:
 * one surface, one subject, no back item, nothing to unwind. A stack made
 * a read-only marketing sheet behave like a router, which is more
 * machinery than "show me that one instead" deserves (owner ruling).
 *
 * It lives as a service rather than in the services section because the
 * two sheets hand off to each other: a row in a barber's price list opens
 * the service sheet, and a performer in the service sheet opens the barber
 * sheet. Each handoff CLOSES the sheet it came from first — one surface at
 * a time, never one over another.
 */
@Injectable({ providedIn: 'root' })
export class CatalogNavigationService {
  private readonly subject = signal<ServiceVm | null>(null);

  /** The service on show, or null when the sheet is closed. */
  readonly current = this.subject.asReadonly();

  /** Open the sheet on a service — or swap the one it's already showing. */
  open(service: ServiceVm): void {
    this.subject.set(service);
  }

  close(): void {
    this.subject.set(null);
  }

  // ── The barber sheet (the team section renders it) ─────────────────
  private readonly barber = signal<string | null>(null);

  /** Which barber the team section's sheet is showing, by id. */
  readonly barberId = this.barber.asReadonly();

  openBarber(barberId: string): void {
    this.barber.set(barberId);
  }

  closeBarber(): void {
    this.barber.set(null);
  }
}
