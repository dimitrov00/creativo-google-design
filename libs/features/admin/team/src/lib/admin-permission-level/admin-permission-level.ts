import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { type StaffLevel, StaffPermissions } from '@core/components';
import { AccessScope, type StaffCapability, Tag } from '@core/primitives';
import { TeamRosterSystem } from '@core/systems';
import { UiButton, UiChoiceMenu, UiSwitch } from '@creativo/ui/controls';
import { UiIcon } from '@creativo/ui/icons';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiPaddingDirective,
  UiRadiusDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiMenuTrigger,
  UiNotice,
  UiPageActionBar,
  UiSectionHeader,
  UiSheetHeader,
  UiToast,
} from '@creativo/ui/patterns';
import { PermissionsStore } from '../permissions.store';
import { TeamWording } from '../team-wording.service';
import { levelPageVm } from '../team.presenter';
import { TeamStore } from '../team.store';
import type { LevelPageVm } from '../team.vm';

/**
 * A LEVEL'S PAGE (staff permissions P10): one question a row, grouped as
 * the capability catalogue groups them. Where a cell offers «Само своите»
 * the answer is a value with a menu; where it does not, a switch. A changed
 * row carries the orange dot and says what the standard was. «Върни
 * стандартните» resets the level; «Запази» is in the dock while the draft
 * differs from what is saved.
 *
 * `level` is the route's own parameter; a word that is no editable level
 * reads as no page.
 */
@Component({
  selector: 'lib-admin-permission-level',
  imports: [
    RouterLink,
    TranslocoDirective,
    UiButton,
    UiChoiceMenu,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiMenuTrigger,
    UiNotice,
    UiPaddingDirective,
    UiPageActionBar,
    UiRadiusDirective,
    UiSectionHeader,
    UiSheetHeader,
    UiStack,
    UiSwitch,
    UiTextDirective,
    UiToast,
    UiVisuallyHiddenDirective,
  ],
  templateUrl: './admin-permission-level.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `team-page`-prefixed.
  encapsulation: ViewEncapsulation.None,
})
export class AdminPermissionLevel {
  protected readonly store = inject(PermissionsStore);
  private readonly team = inject(TeamStore);
  private readonly wording = inject(TeamWording);

  /** The route's `:level` — bound by the router (`withComponentInputBinding`). */
  readonly level = input<string | undefined>(undefined);

  /** The level the page edits; `null` for a word that is no editable level. */
  protected readonly staffLevel = computed<StaffLevel | null>(() => {
    const level = this.level();
    return StaffPermissions.isLevel(level) ? level : null;
  });

  /** The one open menu: a row's key, or none. */
  protected readonly openMenu = signal<string | null>(null);

  protected readonly vm = computed<LevelPageVm | null>(() => {
    const words = this.wording.words();
    const level = this.staffLevel();
    if (words === null || level === null) return null;
    const members = this.team.members();
    return levelPageVm({
      level,
      next: this.store.next(),
      holderCount:
        members === null
          ? null
          : TeamRosterSystem.holdersOf(members, level).length,
      words,
    });
  });

  /** Why the save was refused, in the catalogue's words. */
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  constructor() {
    // How many people the level applies to: the team as last read.
    if (this.team.members() === null) void this.team.load();
  }

  /** A value's menu answered: the scope picked, when it is one. */
  protected pick(
    level: StaffLevel,
    staffCapability: StaffCapability,
    picked: string,
  ): void {
    if (Tag.has(AccessScope, picked)) {
      this.store.set(level, staffCapability, picked);
    }
  }

  /** A switch flipped: everyone, or nobody. */
  protected toggle(
    level: StaffLevel,
    staffCapability: StaffCapability,
    on: boolean,
  ): void {
    this.store.set(
      level,
      staffCapability,
      on ? AccessScope.All : AccessScope.None,
    );
  }

  protected save(): void {
    void this.store.save();
  }
}
