import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  Injector,
  TemplateRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  contentChild,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
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
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiAvatar } from '../avatar/avatar';
import { UiIcon } from '@creativo/ui/icons';
import { UiIconName } from '@creativo/ui/icons';

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
  /**
   * A second line under the label — what the option IS, where the word
   * alone would not say it («Код» · «Промо код или ваучер»; «Купон на
   * клиента» · the coupon's name). Footnote, secondary ink, wraps.
   */
  readonly description?: string;
  /** The row's `data-testid`, when a test needs to find this option. */
  readonly testId?: string;
  /**
   * Whether the row reads chosen — the tint and the accent check —
   * outranking `uiSelectedId` (a menu of two lists, each with its own
   * «all», may hold two chosen rows at once).
   */
  readonly selected?: boolean;
  /**
   * A SUBMENU of tick boxes (owner review 2026-11-09): the row keeps its
   * own pick — its main part reports the row's id — and a hairline and a
   * chevron at its trailing edge open these options in the menu's place
   * (iOS's submenu on a phone: there is no room beside it), each a box
   * that toggles (`uiToggled`) while the menu stays open, under a back
   * row titled `childrenTitle`.
   */
  readonly children?: readonly UiChoiceOption[];
  /** The submenu's title on its back row — «Салони». */
  readonly childrenTitle?: string;
  /** The chevron's accessible name — «Избери салони». */
  readonly openLabel?: string;
  /** The chevron's `data-testid`. */
  readonly openTestId?: string;
  /** On a submenu's option: its box is ticked. */
  readonly checked?: boolean;
  /**
   * The SECTION the option belongs to. Consecutive options of one group
   * are one segmented run; a new group starts a new run, parted by the
   * menu's section seam and captioned with this word when it is not empty
   * («Салони» · «Екип») — HIG menu sections. Absent: one run, no caption.
   */
  readonly group?: string;
}

/** A submenu's tick box flipped: the row it opened from, and the option's id. */
export type UiChoiceToggle = {
  readonly row: string;
  readonly id: string;
};

/** One section of a choice menu: its caption (or none) and its options. */
type UiChoiceSection = {
  readonly title: string;
  readonly options: readonly UiChoiceOption[];
};

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
    UiTextDirective,
  ],
  template: `
    <ui-menu
      [uiAlignment]="uiAlignment()"
      [uiPresented]="uiPresented()"
      [uiLabel]="uiLabel()"
      (uiDismissed)="uiPresented.set(false)"
    >
      <ng-content select="[uiMenuTrigger]" ngProjectAs="[uiMenuTrigger]" />
      @if (submenu(); as page) {
        <!-- THE SUBMENU, in the menu's place: a back row titled with the
             list, then a tick box per option — a toggle keeps the menu up. -->
        <ui-list-group>
          <button
            type="button"
            uiMenuItem
            uiListRow
            [uiInteractive]="true"
            class="ui-choice-menu__back"
            [uiKeepsOpen]="true"
            [attr.data-testid]="(page.openTestId ?? page.id) + '-back'"
            (click)="closePage()"
          >
            <ui-icon uiLeading uiName="nav.back" />
            {{ page.childrenTitle ?? page.label }}
          </button>
        </ui-list-group>
        <ui-list-group
          role="group"
          [attr.aria-label]="page.childrenTitle ?? page.label"
        >
          @for (option of page.children ?? []; track option.id) {
            <button
              type="button"
              uiMenuItem
              uiListRow
              [uiInteractive]="true"
              [uiChecked]="option.checked ?? false"
              [disabled]="option.disabled ?? false"
              [attr.data-testid]="option.testId ?? null"
              (click)="toggle(page, option)"
            >
              <!-- The leading rail is STATIC per branch — a slot that only
                 exists inside a block is projected by that block's single root,
                 so each branch has exactly one. -->
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
                    [uiIcon]="option.icon ?? null"
                    uiControlSize="regular"
                  />
                </span>
              } @else if (option.icon) {
                <ui-icon uiLeading [uiName]="option.icon" />
              }
              {{ option.label }}
              <span
                uiTrailing
                class="ui-choice-menu__box"
                [attr.data-checked]="option.checked ? '' : null"
                aria-hidden="true"
              >
                @if (option.checked) {
                  <ui-icon uiName="checklist.done" />
                }
              </span>
            </button>
          }
        </ui-list-group>
      } @else {
        @for (section of sections(); track $index) {
          @if (section.title) {
            <span
              class="ui-choice-menu__section"
              uiText
              uiFont="footnote"
              uiForegroundStyle="secondary"
              aria-hidden="true"
              >{{ section.title }}</span
            >
          }
          <ui-list-group
            [attr.role]="section.title ? 'group' : null"
            [attr.aria-label]="section.title || null"
          >
            @for (option of section.options; track option.id) {
              @if (option.children; as children) {
                <!-- A ROW WITH A SUBMENU: its own pick, then a hairline and a
                   chevron that open the list's boxes. -->
                <div class="ui-choice-menu__split">
                  <button
                    type="button"
                    uiMenuItem
                    uiListRow
                    [uiInteractive]="true"
                    [uiSelected]="isSelected(option)"
                    [disabled]="option.disabled ?? false"
                    [attr.data-testid]="option.testId ?? null"
                    (click)="pick(option)"
                  >
                    <!-- The leading rail is STATIC per branch — a slot that only
                     exists inside a block is projected by that block's single root,
                     so each branch has exactly one. -->
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
                          [uiIcon]="option.icon ?? null"
                          uiControlSize="regular"
                        />
                      </span>
                    } @else if (option.icon) {
                      <ui-icon uiLeading [uiName]="option.icon" />
                    }
                    @if (option.description) {
                      <span class="ui-choice-menu__lines">
                        <span>{{ option.label }}</span>
                        <span
                          class="ui-choice-menu__description"
                          uiText
                          uiFont="footnote"
                          uiForegroundStyle="secondary"
                          >{{ option.description }}</span
                        >
                      </span>
                    } @else {
                      {{ option.label }}
                    }
                    <span uiTrailing class="ui-choice-menu__trailing">
                      @if (isSelected(option)) {
                        <ui-icon
                          uiName="checklist.done"
                          uiForegroundStyle="accent"
                        />
                      }
                    </span>
                  </button>
                  <button
                    type="button"
                    uiMenuItem
                    class="ui-choice-menu__open"
                    [uiKeepsOpen]="true"
                    [attr.data-choice-open]="option.id"
                    [attr.aria-label]="option.openLabel ?? option.label"
                    aria-haspopup="menu"
                    [attr.data-testid]="option.openTestId ?? null"
                    (click)="openPage(option)"
                  >
                    <ui-icon uiName="nav.disclosure" />
                  </button>
                </div>
              } @else {
                <button
                  type="button"
                  uiMenuItem
                  uiListRow
                  [uiInteractive]="true"
                  [uiSelected]="isSelected(option)"
                  [disabled]="option.disabled ?? false"
                  [attr.data-testid]="option.testId ?? null"
                  (click)="pick(option)"
                >
                  <!-- The leading rail is STATIC per branch — a slot that only
                 exists inside a block is projected by that block's single root,
                 so each branch has exactly one. -->
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
                        [uiIcon]="option.icon ?? null"
                        uiControlSize="regular"
                      />
                    </span>
                  } @else if (option.icon) {
                    <ui-icon uiLeading [uiName]="option.icon" />
                  }
                  @if (option.description) {
                    <span class="ui-choice-menu__lines">
                      <span>{{ option.label }}</span>
                      <span
                        class="ui-choice-menu__description"
                        uiText
                        uiFont="footnote"
                        uiForegroundStyle="secondary"
                        >{{ option.description }}</span
                      >
                    </span>
                  } @else {
                    {{ option.label }}
                  }
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
                    @if (isSelected(option)) {
                      <ui-icon
                        uiName="checklist.done"
                        uiForegroundStyle="accent"
                      />
                    } @else if (option.detail) {
                      <ui-icon
                        class="ui-choice-menu__check-space"
                        uiName="checklist.done"
                      />
                    }
                  </span>
                </button>
              }
            }
          </ui-list-group>
        }
      }
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

  /** The options cut into sections at each change of `group`. */
  protected readonly sections = computed<readonly UiChoiceSection[]>(() => {
    const out: { title: string; options: UiChoiceOption[] }[] = [];
    for (const option of this.uiOptions()) {
      const title = option.group ?? '';
      const last = out.at(-1);
      if (last !== undefined && last.title === title) last.options.push(option);
      else out.push({ title, options: [option] });
    }
    return out;
  });
  readonly uiPresented = model(false);
  readonly uiPicked = output<string>();
  /** A submenu's box flipped — the menu stays open (`UiChoiceOption.children`). */
  readonly uiToggled = output<UiChoiceToggle>();

  protected readonly leading = contentChild(UiChoiceLeading);

  /** The row whose submenu stands in the menu's place; `null` for the top. */
  private readonly page = signal<string | null>(null);
  protected readonly submenu = computed(() => {
    const id = this.page();
    if (id === null || !this.uiPresented()) return null;
    return this.uiOptions().find((option) => option.id === id) ?? null;
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  constructor() {
    // A menu always opens on its top level.
    effect(() => {
      if (!this.uiPresented()) untracked(() => this.page.set(null));
    });
  }

  protected isSelected(option: UiChoiceOption): boolean {
    return option.selected ?? option.id === this.uiSelectedId();
  }

  protected pick(option: UiChoiceOption): void {
    this.uiPresented.set(false);
    this.uiPicked.emit(option.id);
  }

  protected openPage(option: UiChoiceOption): void {
    this.page.set(option.id);
    this.focusFirstItem();
  }

  protected closePage(): void {
    const from = this.page();
    this.page.set(null);
    this.focusFirstItem(from);
  }

  protected toggle(page: UiChoiceOption, option: UiChoiceOption): void {
    this.uiToggled.emit({ row: page.id, id: option.id });
  }

  /**
   * Focus follows the page: its first item — or, back on the top level,
   * the chevron the submenu was opened from — so the arrow keys and
   * Escape keep a home.
   */
  private focusFirstItem(fromId: string | null = null): void {
    afterNextRender(
      () => {
        const root = this.host.nativeElement;
        const back =
          fromId === null
            ? null
            : root.querySelector<HTMLElement>(
                `[data-choice-open="${CSS.escape(fromId)}"]`,
              );
        const target =
          back ??
          root.querySelector<HTMLElement>('.ui-menu__item:not([disabled])');
        target?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }
}
