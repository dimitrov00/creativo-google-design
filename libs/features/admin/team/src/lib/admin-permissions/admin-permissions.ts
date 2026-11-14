import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  type StaffLevel,
  StaffPermissions,
  type TeamMember,
} from '@core/components';
import { TeamRosterSystem } from '@core/systems';
import { UiButton } from '@creativo/ui/controls';
import { UiIcon } from '@creativo/ui/icons';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiPaddingDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiNotice,
  UiPageActionBar,
  UiSheetHeader,
  UiToast,
} from '@creativo/ui/patterns';
import { PermissionsStore } from '../permissions.store';
import { TeamWording } from '../team-wording.service';
import { levelsVm } from '../team.presenter';
import { TeamStore } from '../team.store';
import type { LevelsVm } from '../team.vm';

/**
 * «ПРАВА» — what each staff level may do (staff permissions P10): the three
 * levels the owner edits, each with who holds it and how far it departs
 * from the standard, and «Администратор» as the one line that cannot be
 * cut. A level's row leads to its page; the dock holds «Запази» while the
 * draft differs from what is saved, on whichever of the pages the owner
 * stands.
 */
@Component({
  selector: 'lib-admin-permissions',
  imports: [
    RouterLink,
    TranslocoDirective,
    UiButton,
    UiForegroundStyleDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiNotice,
    UiPaddingDirective,
    UiPageActionBar,
    UiSheetHeader,
    UiStack,
    UiTextDirective,
    UiToast,
    UiVisuallyHiddenDirective,
  ],
  templateUrl: './admin-permissions.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `team-page`-prefixed.
  encapsulation: ViewEncapsulation.None,
})
export class AdminPermissions {
  protected readonly store = inject(PermissionsStore);
  private readonly team = inject(TeamStore);
  private readonly wording = inject(TeamWording);

  /** Who holds each level (`TeamRosterSystem.holdersOf`); `null` until the team has loaded. */
  private readonly holders = computed(() => {
    const members = this.team.members();
    if (members === null) return null;
    return new Map<StaffLevel, readonly TeamMember[]>(
      StaffPermissions.LEVELS.map((level) => [
        level,
        TeamRosterSystem.holdersOf(members, level),
      ]),
    );
  });

  protected readonly vm = computed<LevelsVm | null>(() => {
    const words = this.wording.words();
    return words === null
      ? null
      : levelsVm({
          next: this.store.next(),
          unsaved: this.store.unsaved(),
          holders: this.holders(),
          words,
          locale: this.wording.locale(),
        });
  });

  /** Why the save was refused, in the catalogue's words. */
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  constructor() {
    // The holders' names: the team as last read, and a fresh read behind it.
    void this.team.load();
  }

  protected save(): void {
    void this.store.save();
  }
}
