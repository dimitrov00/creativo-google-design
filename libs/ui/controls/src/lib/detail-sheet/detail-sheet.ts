import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  afterNextRender,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { UiSheetActionBar } from '@creativo/ui/patterns';
import { UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { UiModalSheet } from '../modal-sheet/modal-sheet';

/**
 * The ONE detail-sheet anatomy (extracted from the landing service-detail
 * sheet so every "tap a thing, read about it, act on it" moment across the
 * app shares a single recipe instead of parallel reimplementations):
 * `ui-modal-sheet` shell with the open-next-frame entrance and the
 * two-signal close dance, the condensed toolbar title, the
 * `uiSheetLargeTitle` large-title intro with its scroll-collapse, the
 * summary (description + projected facts), and the docked
 * `ui-sheet-action-bar` whose CONTENT the consumer projects — the
 * "override the toolbar actions" point.
 *
 * ### Slot contract (attribute-marked, all optional)
 * - `[sheet-badge]` — rides the intro under the large title (e.g. bundle).
 * - `[sheet-facts]` — the quick-facts row inside the summary (duration ·
 *   price…).
 * - `[sheet-media]` — gallery/cover between intro and details; full-bleed
 *   (pad it with `.ui-detail-sheet__story` if it should sit in the
 *   gutters).
 * - `[sheet-sections]` — everything after the media (variants, performers,
 *   …); stamp `.ui-detail-sheet__story` on gutter-padded blocks.
 * - `[sheet-actions]` — the docked action bar's controls (a book CTA, a
 *   select toggle…). Always rendered; the sheet without an action is a
 *   different pattern.
 *
 * Mount it conditionally (`@if (thing)`) — it enters on mount and the
 * consumer removes it on `uiClosed`. Programmatic close via a template
 * ref: `<ui-detail-sheet #sheet …>` → `(click)="…; sheet.close()"`.
 *
 * ```html
 * @if (selected(); as service) {
 *   <ui-detail-sheet
 *     #sheet
 *     uiSheetId="service-detail-sheet"
 *     [uiTitle]="service.name"
 *     [uiDescription]="service.description"
 *     [uiCloseLabel]="t('close')"
 *     (uiClosed)="selected.set(null)"
 *   >
 *     <button sheet-actions uiButton uiButtonStyle="borderedProminent">…</button>
 *   </ui-detail-sheet>
 * }
 * ```
 */
@Component({
  selector: 'ui-detail-sheet',
  imports: [UiModalSheet, UiSheetActionBar, UiStack, UiTextDirective],
  template: `
    <ui-modal-sheet
      [sheetId]="uiSheetId()"
      [labelledBy]="titleId()"
      [closeLabel]="uiCloseLabel()"
      [open]="sheetOpen()"
      [closing]="sheetClosing()"
      (dismissed)="close()"
      (closeFinished)="finishClose()"
    >
      <!-- Bare text — the bar owns the HIG nav-title typography; revealed
           by ui-sheet-header once the large title scrolls under it. -->
      <p sheet-title>{{ uiTitle() }}</p>

      <ui-stack uiSpacing="spacious" class="ui-detail-sheet__body">
        <ui-stack
          uiSpacing="loose"
          class="ui-detail-sheet__story ui-detail-sheet__intro"
        >
          <ui-stack uiSpacing="regular" uiAlignment="leading">
            <h2 [id]="titleId()" uiSheetLargeTitle uiText uiFont="largeTitle">
              {{ uiTitle() }}
            </h2>
            <ng-content select="[sheet-badge]" />
          </ui-stack>

          <ui-stack uiSpacing="comfortable" class="ui-detail-sheet__summary">
            @if (uiDescription(); as description) {
              <p uiText uiFont="body" uiForegroundStyle="secondary">
                {{ description }}
              </p>
            }
            <ng-content select="[sheet-facts]" />
          </ui-stack>
        </ui-stack>

        <ng-content select="[sheet-media]" />
        <ng-content select="[sheet-sections]" />
      </ui-stack>

      <!-- Docked for the sheet's whole life; the consumer's projected
           controls ARE the toolbar actions. -->
      <ui-sheet-action-bar
        sheet-overlay
        class="ui-detail-sheet__actions"
        [uiVisible]="true"
      >
        <ng-content select="[sheet-actions]" />
      </ui-sheet-action-bar>
    </ui-modal-sheet>
  `,
  styleUrl: './detail-sheet.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ui-detail-sheet' },
})
export class UiDetailSheet {
  readonly uiSheetId = input.required<string>();
  readonly uiTitle = input.required<string>();
  readonly uiDescription = input<string | undefined>(undefined);
  readonly uiCloseLabel = input.required<string>();

  /** The exit transition finished — remove the sheet from the view now. */
  readonly uiClosed = output<void>();

  protected readonly titleId = computed(() => `${this.uiSheetId()}-title`);

  /** Mounts shut, opens next frame so the sheet animates in. */
  protected readonly sheetOpen = signal(false);
  protected readonly sheetClosing = signal(false);

  constructor() {
    afterNextRender(() => this.sheetOpen.set(true));
  }

  /** Begins the exit — `open` outranks `closing` in the shell's state expression, so BOTH flip. Public: projected actions close via a template ref. */
  close(): void {
    if (!this.sheetOpen() || this.sheetClosing()) return;
    this.sheetOpen.set(false);
    this.sheetClosing.set(true);
  }

  protected finishClose(): void {
    if (!this.sheetClosing()) return;
    this.sheetClosing.set(false);
    this.uiClosed.emit();
  }
}
