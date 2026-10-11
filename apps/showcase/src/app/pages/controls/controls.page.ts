import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiGrid, UiStack } from '@creativo/ui/layout';
import { UiCard, UiSectionHeader } from '@creativo/ui/patterns';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScPage } from '@showcase/shared/page';

interface ControlLink {
  readonly slug: string;
  readonly name: string;
  /** Where the page lives; a control's spec page unless it says otherwise. */
  readonly section?: 'compositions';
}

interface ControlGroup {
  readonly eyebrow: string;
  readonly title: string;
  readonly lede: string;
  readonly links: ControlLink[];
}

@Component({
  selector: 'cr-controls-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ScPage,
    UiCard,
    UiGrid,
    UiSectionHeader,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './controls.page.html',
  styleUrl: './controls.page.css',
})
export class ControlsPage {
  protected readonly groups: ControlGroup[] = [
    {
      eyebrow: 'Stacks · Bars · Surfaces',
      title: 'Layout',
      lede: 'Structural primitives — ≙ SwiftUI stacks, grids, toolbars and presentation surfaces.',
      links: [
        { slug: 'stack', name: 'Stack' },
        { slug: 'grid', name: 'Grid' },
        { slug: 'flow', name: 'Flow' },
        { slug: 'scroll-row', name: 'ScrollRow' },
        { slug: 'scroll-column', name: 'ScrollColumn' },
        { slug: 'toolbar', name: 'Toolbar' },
        { slug: 'sheet', name: 'Sheet' },
        { slug: 'divider-and-spacer', name: 'Divider & Spacer' },
      ],
    },
    {
      eyebrow: 'Buttons · Fields · Indicators',
      title: 'Controls',
      lede: 'The interactive layer — every tap target, input and status indicator in the system.',
      links: [
        { slug: 'button', name: 'Button' },
        { slug: 'text-field', name: 'TextField' },
        { slug: 'slider', name: 'Slider' },
        { slug: 'segmented-control', name: 'SegmentedControl' },
        { slug: 'chip', name: 'Chip' },
        { slug: 'badge', name: 'Badge' },
        { slug: 'avatar', name: 'Avatar' },
        { slug: 'progress-view', name: 'ProgressView' },
        { slug: 'skeleton', name: 'Skeleton' },
        { slug: 'otp-field', name: 'OTP Field' },
        { slug: 'phone-field', name: 'Phone Field' },
        { slug: 'date-field', name: 'Date Field' },
        { slug: 'month-picker', name: 'MonthPicker' },
        { slug: 'icon', name: 'Icon' },
        { slug: 'async-image', name: 'AsyncImage' },
      ],
    },
    {
      eyebrow: 'Cards · Rows · Headers',
      title: 'Patterns',
      lede: 'Sanctioned recipes composed from the primitives — the one right way to assemble common surfaces.',
      links: [
        { slug: 'card', name: 'Card' },
        { slug: 'list-row', name: 'ListRow' },
        { slug: 'menu', name: 'Menu' },
        { slug: 'section-header', name: 'SectionHeader' },
        { slug: 'sheet-headline', name: 'SheetHeadline' },
        { slug: 'stepper', name: 'Stepper' },
        { slug: 'quick-actions', name: 'QuickActions' },
        { slug: 'notice', name: 'Notice' },
        { slug: 'date-tile', name: 'DateTile' },
        { slug: 'coupon-card', name: 'CouponCard' },
        { slug: 'pass-card', name: 'PassCard' },
      ],
    },
    {
      eyebrow: 'Meters · Marks · Medals',
      title: 'Progress and standing',
      lede: 'How far along something persistent stands — a balance, a card, a rhythm, a level — read at a glance and said in words.',
      links: [
        { slug: 'metric', name: 'Metric' },
        { slug: 'gauge', name: 'Gauge' },
        { slug: 'mark-scale', name: 'MarkScale' },
        { slug: 'streak-track', name: 'StreakTrack' },
        { slug: 'medal', name: 'Medal' },
      ],
    },
    {
      eyebrow: 'Pieces · Put together',
      title: 'Compositions',
      lede: 'The primitives composed the way a page composes them — real pixels to judge a design by, before a feature is built on it.',
      links: [
        { slug: 'client-card', name: 'Client card', section: 'compositions' },
      ],
    },
  ];
}
