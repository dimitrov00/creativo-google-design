import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
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
 */
@Component({
  selector: 'cr-forbidden-page',
  imports: [
    TranslocoPipe,
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
        <ui-stack uiSpacing="comfortable" uiFrame uiFrameMaxWidth="28rem">
          <h1 uiText uiFont="title">
            {{ 'shell.forbidden.title' | transloco }}
          </h1>
          <p uiText uiFont="body" uiForegroundStyle="secondary">
            {{ 'shell.forbidden.body' | transloco }}
          </p>
        </ui-stack>
        <ui-spacer />
      </ui-stack>
    </main>
  `,
})
export class ForbiddenPage {}
