import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * `rolesGuard`'s redirect target (blueprint §1.4) — a signed-in principal
 * without the required role lands here instead of bouncing through
 * `/auth`. Shell-owned chrome, not a feature slice (scope guard: screens
 * stay placeholders beyond what guards/redirects need).
 */
@Component({
  selector: 'cr-forbidden-page',
  imports: [TranslocoPipe],
  template: `
    <main>
      <h1>{{ 'shell.forbidden.title' | transloco }}</h1>
      <p>{{ 'shell.forbidden.body' | transloco }}</p>
    </main>
  `,
})
export class ForbiddenPage {}
