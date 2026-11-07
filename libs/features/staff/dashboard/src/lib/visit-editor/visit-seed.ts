import { DraftPersonKey, type Tag, TrackMinute } from '@core/primitives';
import type { BarberId, DurationMinutes, PriceCents } from '@core/primitives';
import type { StaffEditDraft } from '@core/components';
import { VisitDraftSystem, VisitSidesSystem } from '@core/systems';
import { type FrameInterval, withFrame } from './frame-draft';
import type {
  DraftClient,
  DraftLeg,
  VisitDraft,
  VisitEditorCommit,
  VisitEditorLeg,
  VisitEditorVm,
} from './staff-visit-editor';

/*
 * THE VISIT'S SEED AND COMMIT, outside the sheet's component file: the
 * schedule saves a grid drop (`snapshotCommitOf`) with no sheet open, so
 * these pure functions load with the schedule while the sheet itself is
 * fetched on demand (`@defer` in the dashboard's template).
 */

/**
 * The add-client page's sections the staff dashboard supplies, by key —
 * values: external contract (the `staff-visit-clients-<id>` test id), so
 * they keep their spelling.
 */
export const VisitEditorClientSectionId = {
  /** «Скорошни» — the shop's last visitors. */
  Recent: 'recent',
} as const;
export type VisitEditorClientSectionId = Tag<typeof VisitEditorClientSectionId>;

/** The minutes a draft describes — its override, or the legs it holds (`VisitDraftSystem.span`). */
export function spanOf(draft: VisitDraft): DurationMinutes {
  return VisitDraftSystem.span(draft.durationOverride, draft.legs);
}

/** The people a VM seeds — its party, else its one named client, else nobody. */
export function seedClientsOf(vm: VisitEditorVm): readonly DraftClient[] {
  // A NEW visit starts with nobody in the chair; the add row invites one.
  if (vm.people?.length) return vm.people;
  if (!vm.clientLabel) return [];
  return [
    {
      // The account's key is its uid, as is; nobody's account sits on the placeholder.
      id:
        vm.clientUserId === null
          ? DraftPersonKey.PLACEHOLDER
          : DraftPersonKey.account(vm.clientUserId),
      label: vm.clientLabel,
      phone: vm.phone,
      phoneHref: vm.phoneHref,
      meta: vm.clientMeta,
      // The VM's one client comes with no mail (what an absent one always read as).
      email: null,
    },
  ];
}

/**
 * The VM's seats as the draft holds them: each for its person (else the
 * first), nobody's price typed. A VM leg is a stored seat or a rebooked
 * one, so its chair is always known — the snapshot reads these as they are.
 */
export function seedLegsOf(
  vm: VisitEditorVm,
  clients: readonly DraftClient[],
): readonly (VisitEditorLeg & {
  readonly clientId: DraftPersonKey;
  readonly typedPriceCents: null;
})[] {
  const firstClient = clients[0]?.id ?? DraftPersonKey.PLACEHOLDER;
  return vm.legs.map((leg) => ({
    ...leg,
    clientId: leg.clientId ?? firstClient,
    typedPriceCents: null,
  }));
}

export function seedDraft(vm: VisitEditorVm): VisitDraft {
  const clients = seedClientsOf(vm);
  const legs = seedLegsOf(vm, clients);
  return {
    revision: vm.revision ?? null,
    dayKey: vm.dayKey,
    dayLabel: vm.dayLabel,
    startMinute: vm.startMinute,
    // Only pin a number when the booked span never was the catalogue's —
    // measured on the track, so a frame seeded past the closing midnight (a
    // new visit opened after 23:30) opens. No save accepts it until it is
    // moved back onto the day: a 24:00 start is refused on this side, an end
    // past midnight by the server.
    durationOverride: VisitDraftSystem.durationOverrideOf(
      vm.startMinute,
      vm.endMinute,
      legs,
    ),
    chairId: vm.chairId,
    locationId: vm.locationId ?? null,
    legs,
    clients,
    note: vm.teamNote,
    discounts: vm.discounts,
    vouchers: vm.vouchers,
    tipCents: vm.tipCents,
    drawn: { note: vm.teamNote, tipCents: vm.tipCents },
  };
}

/** One leg as «Запази» publishes it — the chair known, the typed price as given. */
export function commitLegOf(
  leg: DraftLeg,
  barberId: BarberId,
  typedPriceCents: PriceCents | null,
): StaffEditDraft.Leg {
  return {
    seatId: leg.seatId,
    serviceId: leg.serviceId,
    variantId: leg.variantId,
    durationMinutes: leg.durationMinutes,
    priceCents: leg.priceCents,
    currency: leg.currency,
    typedPriceCents,
    barberId,
    clientId: leg.clientId,
  };
}

/**
 * The draft as «Запази» publishes it — ONE function for the live draft and
 * for a snapshot (`snapshotCommitOf`), so a save and its undo speak the
 * same shape and the owner's plan (`StaffEditPlanSystem.commandsFor`)
 * serves both. Every property is present: a draft that claims no revision
 * says `null`, and so does a leg nobody repriced (`typedPriceCents`).
 */
export function commitOf(
  draft: VisitDraft,
  endMinute: TrackMinute,
  legs: readonly StaffEditDraft.Leg[],
): VisitEditorCommit {
  return {
    revision: draft.revision,
    dayKey: draft.dayKey,
    startMinute: draft.startMinute,
    endMinute,
    locationId: draft.locationId,
    note: VisitSidesSystem.storedNote(draft.note),
    discounts: draft.discounts,
    vouchers: draft.vouchers,
    tipCents: draft.tipCents,
    drawn: draft.drawn,
    // The number AND the mail the desk has for each person (OR-26): what
    // the plan turns into a guest's contact, and the server into the
    // walk-in's record — never dropped on the way.
    clients: draft.clients.map((client) => ({
      id: client.id,
      label: client.label,
      phone: client.phone,
      email: client.email,
    })),
    legs,
  };
}

/**
 * The live draft's legs as published — or `null` while one has no chair
 * yet (a leg drafted before the sheet knew one, `barberId` `null`: the
 * save has no barber to seat it with, so it waits, `saveable`). Only a
 * TYPED price travels; an untouched leg's typed price is `null`.
 */
export function draftCommitLegsOf(
  draft: VisitDraft,
): readonly StaffEditDraft.Leg[] | null {
  const legs: StaffEditDraft.Leg[] = [];
  for (const leg of draft.legs) {
    if (leg.barberId === null) return null;
    legs.push(commitLegOf(leg, leg.barberId, leg.typedPriceCents));
  }
  return legs;
}

/**
 * THE SNAPSHOT a save's undo aims at (owner, 2026-09-23: "the save receipt
 * with whole-save undo"): the sheet's seed, published as if «Запази» had
 * been pressed on it untouched. Every leg carries its STORED price as its
 * typed figure, so a seat the save repriced can be priced back — the live
 * draft only carries a price somebody typed. The price is the seat's cents
 * (pass D, D-10.3), never its label read back. With a `frame`, the same
 * seed with a grid drop laid on it (`withFrame`) — the drop's own save.
 */
export function snapshotCommitOf(
  vm: VisitEditorVm,
  frame: FrameInterval | null = null,
): VisitEditorCommit {
  const seed = frame ? withFrame(seedDraft(vm), frame) : seedDraft(vm);
  const legs = seedLegsOf(vm, seed.clients).map((leg) =>
    commitLegOf(leg, leg.barberId, leg.priceCents),
  );
  return commitOf(seed, TrackMinute.plus(seed.startMinute, spanOf(seed)), legs);
}
