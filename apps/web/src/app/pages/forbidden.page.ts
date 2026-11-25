import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiButton } from '@creativo/ui/controls';
import { UiSpacer, UiStack } from '@creativo/ui/layout';
import {
  UiFrameDirective,
  UiPaddingDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';

/**
 * `rolesGuard`'s redirect target (blueprint §1.4) — a signed-in principal
 * without the required role lands here instead of bouncing through
 * `/auth`. Shell-owned chrome, not a feature slice (scope guard: screens
 * stay placeholders beyond what guards/redirects need).
 *
 * It ends in ONE way out (2026-11-24): the installed app has no browser
 * back, so a page with only a sentence on it was a dead end. `/` is the
 * dispatcher — the installed app's home gate sends a signed-in person on
 * to their home, a browser tab shows the landing with its menu.
 */
@Component({
  selector: 'cr-forbidden-page',
  imports: [
    RouterLink,
    TranslocoPipe,
    UiButton,
    UiFrameDirective,
    UiPaddingDirective,
    UiSpacer,
    UiStack,
    UiTextDirective,
  ],
  template: `
    <main>
      <ui-stack
        uiAlignment="center"
        uiSpacing="none"
        uiFrame
        uiFrameMinHeight="100svh"
        uiPaddingHorizontal="regular"
        uiPaddingVertical="spacious"
      >
        <ui-spacer />
        <ui-stack
          uiSpacing="comfortable"
          uiAlignment="leading"
          uiFrame
          uiFrameMaxWidth="28rem"
        >
          <h1 uiText uiFont="title">
            {{ 'shell.forbidden.title' | transloco }}
          </h1>
          <p uiText uiFont="body" uiForegroundStyle="secondary">
            {{ 'shell.forbidden.body' | transloco }}
          </p>
          <a
            routerLink="/"
            uiButton
            uiButtonStyle="bordered"
            uiControlSize="regular"
            data-testid="forbidden-home"
          >
            {{ 'shell.forbidden.home' | transloco }}
          </a>
        </ui-stack>
        <ui-spacer />
      </ui-stack>
    </main>
  `,
})
export class ForbiddenPage {}
