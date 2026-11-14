import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import type { BarberOffering } from '@core/components';
import type { Barber, Service } from '@core/entities';
import type { ServiceId, ServiceVariantId } from '@core/primitives';
import { OfferingEditSystem } from '@core/systems';
import { CatalogContentService } from '@creativo/features/shared/catalog';
import {
  UiButton,
  UiModalSheet,
  UiSwitch,
  UiUnitField,
  parseAmountFigure,
} from '@creativo/ui/controls';
import { UiIcon } from '@creativo/ui/icons';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiNotice,
  UiSectionHeader,
  UiSheetActionBar,
  UiSheetHeadline,
} from '@creativo/ui/patterns';
import { offeringsVm } from '../offerings.presenter';
import type { OfferingsVm } from '../offerings.vm';
import { TeamMemberStore } from '../team-member.store';
import { TeamWording } from '../team-wording.service';

/**
 * «УСЛУГИ И ЦЕНИ» — what a barber performs, and at what price (team
 * onboarding D5): the catalogue's services, one row each. A row opens the
 * service's own page — whether the barber performs it, their price and
 * time, and each variant's when the service has them — the grammar of the
 * weekly hours sheet (a week of rows, a page per day). A service switched
 * on starts at the catalogue's own terms.
 *
 * Nothing is written until «Запази»: the WHOLE list as ONE act
 * (`setBarberOfferings`), so a service left out is no longer theirs. The
 * sheet holds the list as a draft and decides nothing: what a typed price
 * does to it is `OfferingEditSystem.withTerms`' answer, and whether the
 * draft may be saved — and changes anything at all — is
 * `OfferingEditSystem.plan`'s, the very rule the server asks. Mounted while
 * it is open, so every opening starts from the catalogue as it stands.
 */
@Component({
  selector: 'lib-member-offerings-sheet',
  imports: [
    TranslocoDirective,
    UiButton,
    UiForegroundStyleDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiModalSheet,
    UiNotice,
    UiSectionHeader,
    UiSheetActionBar,
    UiSheetHeadline,
    UiSwitch,
    UiTextDirective,
    UiUnitField,
  ],
  templateUrl: './member-offerings-sheet.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `team-page`-prefixed.
  encapsulation: ViewEncapsulation.None,
})
export class MemberOfferingsSheet implements OnInit {
  protected readonly store = inject(TeamMemberStore);
  private readonly wording = inject(TeamWording);
  private readonly content = inject(CatalogContentService);

  /** The record the sheet edits. */
  readonly uiBarber = input.required<Barber>();
  /** The sheet is leaving: its close animation runs. */
  readonly uiClosing = input(false);
  /** ✕, Escape, the scrim — or a save that landed. */
  readonly dismissed = output<void>();
  /** The close animation ended. */
  readonly closeFinished = output<void>();

  /** The catalogue's services, in its own order. */
  private readonly services = this.content.allServices;
  /** The complete list of what the barber performs, as drafted. */
  private readonly entries = signal<readonly BarberOffering.Entry[]>([]);
  /** The service whose page is open; `null` on the list. */
  protected readonly openServiceId = signal<ServiceId | null>(null);

  /** What the draft would change — the server's own rule, asked here. */
  private readonly plan = computed(() =>
    OfferingEditSystem.plan(
      this.services(),
      this.uiBarber().id,
      this.entries(),
    ),
  );

  /** The list would be taken, and it changes something. */
  protected readonly canSave = computed(() => {
    const plan = this.plan();
    return plan.ok && plan.value.length > 0;
  });

  protected readonly vm = computed<OfferingsVm | null>(() => {
    const words = this.wording.offeringWords();
    return words === null
      ? null
      : offeringsVm({
          services: this.services(),
          entries: this.entries(),
          openServiceId: this.openServiceId(),
          words,
          locale: this.wording.locale(),
        });
  });

  /** Why the save was refused, in the catalogue's words. */
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  /** The list as the catalogue holds it when the sheet opens: read once. */
  ngOnInit(): void {
    this.entries.set(
      OfferingEditSystem.entriesOf(
        untracked(this.services),
        untracked(this.uiBarber).id,
      ),
    );
  }

  /** «Извършва»: on at the catalogue's own terms, or off the list. */
  protected setPerformed(serviceId: ServiceId, on: boolean): void {
    const service = this.serviceOf(serviceId);
    if (service === undefined) return;
    this.entries.update((entries) => {
      const others = entries.filter((entry) => entry.serviceId !== serviceId);
      return on ? [...others, OfferingEditSystem.entryFor(service)] : others;
    });
  }

  /** A price was typed: kept when it is an amount, else the field goes back. */
  protected setPrice(
    serviceId: ServiceId,
    variantId: ServiceVariantId | null,
    typed: string,
  ): void {
    const priceCents = parseAmountFigure(typed);
    if (priceCents !== null)
      this.retermed(serviceId, variantId, { priceCents });
  }

  /** A time was typed: kept when it is whole minutes, else the field goes back. */
  protected setMinutes(
    serviceId: ServiceId,
    variantId: ServiceVariantId | null,
    typed: string,
  ): void {
    const durationMinutes = parseAmountFigure(typed, 0);
    if (durationMinutes !== null) {
      this.retermed(serviceId, variantId, { durationMinutes });
    }
  }

  protected async save(): Promise<void> {
    if (!this.canSave() || this.store.pending()) return;
    if (await this.store.saveOfferings(this.entries())) this.dismissed.emit();
  }

  private serviceOf(serviceId: ServiceId): Service | undefined {
    return this.services().find((service) => service.id === serviceId);
  }

  /** One entry of the draft with a price or a time typed into the terms it held. */
  private retermed(
    serviceId: ServiceId,
    variantId: ServiceVariantId | null,
    figure: { readonly priceCents?: number; readonly durationMinutes?: number },
  ): void {
    const service = this.serviceOf(serviceId);
    if (service === undefined) return;
    this.entries.update((entries) =>
      entries.map((entry) =>
        entry.serviceId === serviceId
          ? OfferingEditSystem.withTerms(entry, service.variants, variantId, {
              ...OfferingEditSystem.termsAt(entry, variantId),
              ...figure,
            })
          : entry,
      ),
    );
  }
}
