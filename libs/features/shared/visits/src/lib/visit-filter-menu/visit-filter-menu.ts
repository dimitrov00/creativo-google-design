import {
  ChangeDetectionStrategy,
  Component,
  HostAttributeToken,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { translateSignal } from '@jsverse/transloco';
import {
  UiButton,
  type UiControlSize,
  UiChoiceMenu,
  type UiChoiceOption,
  UiIcon,
  UiMenuTrigger,
} from '@creativo/ui/controls';
import { visitFilterWords } from '@creativo/infrastructure/i18n';
import { VisitListSystem } from '@core/systems';
import { visitFilterWordKey } from '../visit-filter';
import { VisitFilter, type VisitPerspective } from '../visit-row.vm';

/**
 * THE FUNNEL (client-card redesign §5.3.3) — the ONE filter menu both
 * visit lists narrow with: «Моите часове» and the staff card's history.
 *
 * The house funnel (`client-appointments.html:70-124`) moved here and put
 * on the DS's one choice menu (owner, 2026-09-09: "any other choice menu
 * should be styled the same way, and it should be a reusable component")
 * instead of the hand-assembled `ui-menu` + `ui-list-group` + check glyph
 * it was. The trigger is the bar's icon-only funnel — bordered, neutral,
 * 44 — and it goes to the accent while it bites (`uiTint` unset: the
 * button's own accent wash, no feature paint), because a list that is
 * hiding things has to say so; its name says which option bites, the fact
 * the tint cannot carry to a reader.
 *
 * THE ACCENT LAW (revision 3 §1.3): colour is a shape, so the glyph of a
 * biting funnel stays INK (an icon-only bordered button keeps the
 * foreground glyph: nothing else names it, and the orange on its own wash
 * is 2.67:1) and the funnel wears an accent DOT on its rim, top trailing,
 * where a count badge would ride. The wash and the dot say «narrowed»; the
 * name says to what.
 *
 * PINNED at the pill rail's trailing end (`visitPillsAction`, the staff
 * card's «Посещения») the funnel is the rail's own height, 36, without
 * being asked: it reads the slot's attribute off its host. `controlSize`
 * says it outright where a host wants another rung.
 *
 * The options and their order are the perspective's
 * (`VisitListSystem.filtersFor`), one word differing by who reads it
 * (`visitFilterWordKey`: a client «Пропуснати» their own hour, a barber
 * records «Неявявания»). A host that knows its rows passes `offered`, and an
 * option nothing answers is left out rather than offered to lead nowhere
 * (absent, never disabled). Test ids are the host's family — the client keeps
 * `appointments-filter` / `appointments-filter-{option}`, the staff card
 * stamps `history-filter` / `history-filter-{option}` (R17).
 */
@Component({
  selector: 'lib-visit-filter',
  imports: [UiButton, UiChoiceMenu, UiIcon, UiMenuTrigger],
  template: `
    <ui-choice-menu
      uiAlignment="trailing"
      [uiOptions]="options()"
      [uiSelectedId]="value()"
      [uiLabel]="menuLabel()"
      [(uiPresented)]="presented"
      (uiPicked)="pick($event)"
    >
      <button
        uiMenuTrigger
        type="button"
        uiButton
        uiButtonStyle="bordered"
        [uiTint]="filtering() ? undefined : 'neutral'"
        [uiControlSize]="size()"
        [uiIconOnly]="true"
        class="visit-filter__trigger"
        [attr.aria-label]="triggerLabel()"
        [title]="triggerLabel()"
        [attr.data-testid]="testIdPrefix()"
        [attr.data-filtering]="filtering() ? '' : null"
        (click)="presented.set(!presented())"
      >
        <ui-icon uiName="action.filter" />
        @if (filtering()) {
          <span class="visit-filter__dot" aria-hidden="true"></span>
        }
      </button>
    </ui-choice-menu>
  `,
  styleUrl: './visit-filter-menu.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisitFilterMenu {
  /** The choice, two-way: the host narrows its rows with `VisitListSystem.matches`. */
  readonly value = model<VisitFilter>(VisitFilter.All);
  readonly perspective = input.required<VisitPerspective>();
  /** The trigger's test id; each option's is `{prefix}-{option}`. */
  readonly testIdPrefix = input.required<string>();
  /**
   * The options the host's rows can answer (`VisitListSystem.offered`): the
   * rest are left out, never disabled. `all` and the choice in force always
   * stay, so a narrowed list can always be widened again. Null offers every
   * option of the perspective.
   */
  readonly offered = input<readonly VisitFilter[] | null>(null);
  /**
   * The trigger's rung. `null` is the place's own: `small` (36) pinned at
   * the pill rail's end, `regular` (44) in a bar.
   */
  readonly controlSize = input<UiControlSize | null>(null);

  /** Projected into the pill rail's slot: the host wears the slot's attribute. */
  private readonly pinned =
    inject(new HostAttributeToken('visitPillsAction'), { optional: true }) !==
    null;

  protected readonly size = computed<UiControlSize>(
    () => this.controlSize() ?? (this.pinned ? 'small' : 'regular'),
  );

  protected readonly presented = signal(false);

  /** A narrowed list says so: the accent wash, the dot and `data-filtering`. */
  protected readonly filtering = computed(
    () => this.value() !== VisitFilter.All,
  );

  private readonly filters = computed(() =>
    VisitListSystem.filtersFor(this.perspective()),
  );

  /**
   * The words as signals — Transloco's own reactive reading, so a language
   * switch or a late catalogue load re-words the menu without this
   * component ever calling `translate()` from a `computed` (which writes
   * what it reads, and never settles).
   */
  protected readonly menuLabel = translateSignal('visits.filter.label');
  private readonly optionWords = translateSignal(
    computed(() =>
      this.filters().map((filter) =>
        visitFilterWordKey(filter, this.perspective()),
      ),
    ),
  );

  protected readonly options = computed<readonly UiChoiceOption[]>(() => {
    const words = this.optionWords();
    const offered = this.offered();
    const value = this.value();
    return this.filters().flatMap((filter, index) =>
      offered === null ||
      filter === VisitFilter.All ||
      filter === value ||
      offered.includes(filter)
        ? [
            {
              id: filter,
              label: words.at(index) ?? '',
              // eslint-disable-next-line security/detect-object-injection -- `filter` is a member of the closed dictionary the table is total over.
              testId: `${this.testIdPrefix()}-${visitFilterWords[filter]}`,
            },
          ]
        : [],
    );
  });

  /**
   * «Филтър: Всички» — the trigger names the choice in force, narrowed or
   * not, since the glyph alone says neither (§3.6 HD).
   */
  protected readonly triggerLabel = computed(() => {
    const current = this.options().find((option) => option.id === this.value());
    return current === undefined || current.label === ''
      ? this.menuLabel()
      : `${this.menuLabel()}: ${current.label}`;
  });

  /** The menu hands back an option's id; only an option it offered is taken. */
  protected pick(id: string): void {
    const offered = this.options().some((option) => option.id === id);
    const picked = this.filters().find((filter) => filter === id);
    if (offered && picked !== undefined) this.value.set(picked);
  }
}
