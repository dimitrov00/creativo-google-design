import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiStack } from '@creativo/ui/layout';
import { UiSectionHeader } from '@creativo/ui/patterns';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-section-header-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiSectionHeader, UiStack, UiTextDirective],
  templateUrl: './section-header.page.html',
  styleUrl: './section-header.page.css',
})
export class SectionHeaderPage {}
