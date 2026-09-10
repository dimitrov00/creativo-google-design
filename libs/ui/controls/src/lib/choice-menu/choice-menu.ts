import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  ViewEncapsulation,
  contentChild,
  inject,
  input,
  model,
  output,
} from '@angular/core';
import {
  UiListGroup,
  UiListRow,
  UiMenu,
  UiMenuAlignment,
  UiMenuItem,
} from '@creativo/ui/patterns';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
} from '@creativo/ui/modifiers';
import { UiAvatar } from '../avatar/avatar';
import { UiIcon } from '../icon/icon';
import { UiIconName } from '../icon/icon-registry';

/**
 * One option in a `ui-choice-menu`.
 *
 * `avatarSrc` present (even `null`) means "this option is a person" — the
 * row leads with a portrait, initials when there is no image. `icon` leads
 * with a glyph. Neither means a bare label. A consumer that needs a leading
 * rail the DS does not draw (a colour legend badged to a portrait) projects
 * an `<ng-template uiChoiceLeading let-option>` instead.
 */
export interface UiChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly avatarSrc?: string | null;
  readonly icon?: UiIconName;
  readonly disabled?: boolean;
  /**
   * A figure the option carries — «1,40 €» on «5%» — drawn at the trailing
   * edge in the secondary tone, never folded into the label (owner,
   * 2026-09-10: «5% · 1,40 €» as one label read as confusing).
   */
  readonly detail?: string;
  /** The row's `data-testid`, when a test needs to find this option. */
  readonly testId?: string;
}

/** The consumer's own leading rail: `<ng-template uiChoiceLeading let-option>`. */
@Directive({ selector: 'ng-template[uiChoiceLeading]' })
export class UiChoiceLeading {
  readonly template =
    inject<TemplateRef<{ $implicit: UiChoiceOption }>>(TemplateRef);
}

/**
 * THE CHOICE MENU — one option out of a few, in a popover (owner ruling
 * 2026-09-09: "any other choice menu should be styled the same way, and it
 * should be a reusable component").
 *
 * It is the composition the booking flow's pickers and the staff sheet's
 * barber picker had each assembled by hand: a `ui-menu` (the rounded,
 * translucent, blurred surface with its keyboard model and light dismiss),
 * a `ui-list-group` inside it (the segmented run), one `uiMenuItem uiListRow`
 * per option (`menuitemradio` + `aria-checked`, the selected-row tint), a
 * leading portrait or glyph, and the accent check on the chosen one.
 * Assembled here once, so a menu of two words and a menu of four faces
 * are the same control.
 *
 * The TRIGGER is the consumer's — a pill, a chip, an avatar button — and is
 * projected by `[uiMenuTrigger]`, exactly as with a bare `ui-menu`. Extra
 * content after the options (a second group holding an action) projects
 * into the default slot.
 *
 * `uiPresented` is a model: the consumer opens it from the trigger's click
 * and may close it when another popover opens; a pick closes it here.
 */
@Component({
  selector: 'ui-choice-menu',
  imports: [
    NgTemplateOutlet,
    UiAvatar,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiMenu,
    UiMenuItem,
  ],
  template: `
    <ui-menu
      [uiAlignment]="uiAlignment()"
      [uiPresented]="uiPresented()"
      [uiLabel]="uiLabel()"
      (uiDismissed)="uiPresented.set(false)"
    >
      <ng-content select="[uiMenuTrigger]" ngProjectAs="[uiMenuTrigger]" />
      <ui-list-group>
        @for (option of uiOptions(); track option.id) {
          <button
            type="button"
            uiMenuItem
            uiListRow
            [uiInteractive]="true"
            [uiSelected]="option.id === uiSelectedId()"
            [disabled]="option.disabled ?? false"
            [attr.data-testid]="option.testId ?? null"
            (click)="pick(option)"
          >
            <!-- The leading rail is STATIC per branch — a slot that only
                 exists inside a block is projected by that block's single
                 root, so each branch has exactly one. -->
            @if (leading(); as slot) {
              <span uiLeading>
                <ng-container
                  *ngTemplateOutlet="
                    slot.template;
                    context: { $implicit: option }
                  "
                />
              </span>
            } @else if (option.avatarSrc !== undefined) {
              <span uiLeading>
                <ui-avatar
                  [uiSrc]="option.avatarSrc"
                  [uiName]="option.label"
                  uiControlSize="regular"
                />
              </span>
            } @else if (option.icon) {
              <ui-icon uiLeading [uiName]="option.icon" />
            }
            {{ option.label }}
            <!-- The DETAIL reads muted on the chosen row too, and the check
                 keeps its column on every row that carries a detail, so the
                 figures line up down the run. -->
            <span uiTrailing class="ui-choice-menu__trailing">
              @if (option.detail) {
                <span
                  class="ui-choice-menu__detail"
                  uiForegroundStyle="secondary"
                  >{{ option.detail }}</span
                >
              }
              @if (option.id === uiSelectedId()) {
                <ui-icon uiName="checklist.done" uiForegroundStyle="accent" />
              } @else if (option.detail) {
                <ui-icon
                  class="ui-choice-menu__check-space"
                  uiName="checklist.done"
                />
              }
            </span>
          </button>
        }
      </ui-list-group>
      <ng-content />
    </ui-menu>
  `,
  styleUrl: './choice-menu.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, like every DS composition: `.ui-*` is the styling contract,
  // and the menu's own stylesheet already lays a picker run out.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ui-choice-menu' },
})
export class UiChoiceMenu {
  readonly uiOptions = input.required<readonly UiChoiceOption[]>();
  readonly uiSelectedId = input<string | null>(null);
  /** The menu's accessible name — what the choice is OF. */
  readonly uiLabel = input('');
  readonly uiAlignment = input<UiMenuAlignment>('leading');
  readonly uiPresented = model(false);
  readonly uiPicked = output<string>();

  protected readonly leading = contentChild(UiChoiceLeading);

  protected pick(option: UiChoiceOption): void {
    this.uiPresented.set(false);
    this.uiPicked.emit(option.id);
  }
}
