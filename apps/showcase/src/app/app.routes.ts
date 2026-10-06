import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    redirectTo: 'controls',
    pathMatch: 'full',
  },
  {
    path: 'tokens',
    loadComponent: () =>
      import('./pages/tokens/tokens.page').then((m) => m.TokensPage),
  },
  {
    path: 'controls',
    loadComponent: () =>
      import('./pages/controls/controls.page').then((m) => m.ControlsPage),
  },
  {
    path: 'controls/button',
    loadComponent: () =>
      import('./pages/controls/button/button.page').then((m) => m.ButtonPage),
  },
  {
    path: 'controls/text-field',
    loadComponent: () =>
      import('./pages/controls/text-field/text-field.page').then(
        (m) => m.TextFieldPage,
      ),
  },
  {
    path: 'controls/otp-field',
    loadComponent: () =>
      import('./pages/controls/otp-field/otp-field.page').then(
        (m) => m.OtpFieldPage,
      ),
  },
  {
    path: 'controls/phone-field',
    loadComponent: () =>
      import('./pages/controls/phone-field/phone-field.page').then(
        (m) => m.PhoneFieldPage,
      ),
  },
  {
    path: 'controls/date-field',
    loadComponent: () =>
      import('./pages/controls/date-field/date-field.page').then(
        (m) => m.DateFieldPage,
      ),
  },
  {
    path: 'controls/chip',
    loadComponent: () =>
      import('./pages/controls/chip/chip.page').then((m) => m.ChipPage),
  },
  {
    path: 'controls/badge',
    loadComponent: () =>
      import('./pages/controls/badge/badge.page').then((m) => m.BadgePage),
  },
  {
    path: 'controls/avatar',
    loadComponent: () =>
      import('./pages/controls/avatar/avatar.page').then((m) => m.AvatarPage),
  },
  {
    path: 'controls/progress-view',
    loadComponent: () =>
      import('./pages/controls/progress-view/progress-view.page').then(
        (m) => m.ProgressViewPage,
      ),
  },
  {
    path: 'controls/skeleton',
    loadComponent: () =>
      import('./pages/controls/skeleton/skeleton.page').then(
        (m) => m.SkeletonPage,
      ),
  },
  {
    path: 'controls/stack',
    loadComponent: () =>
      import('./pages/controls/stack/stack.page').then((m) => m.StackPage),
  },
  {
    path: 'controls/toolbar',
    loadComponent: () =>
      import('./pages/controls/toolbar/toolbar.page').then(
        (m) => m.ToolbarPage,
      ),
  },
  {
    path: 'controls/sheet',
    loadComponent: () =>
      import('./pages/controls/sheet/sheet.page').then((m) => m.SheetPage),
  },
  {
    path: 'controls/card',
    loadComponent: () =>
      import('./pages/controls/card/card.page').then((m) => m.CardPage),
  },
  {
    path: 'controls/grid',
    loadComponent: () =>
      import('./pages/controls/grid/grid.page').then((m) => m.GridPage),
  },
  {
    path: 'controls/flow',
    loadComponent: () =>
      import('./pages/controls/flow/flow.page').then((m) => m.FlowPage),
  },
  {
    path: 'controls/scroll-row',
    loadComponent: () =>
      import('./pages/controls/scroll-row/scroll-row.page').then(
        (m) => m.ScrollRowPage,
      ),
  },
  {
    path: 'controls/scroll-column',
    loadComponent: () =>
      import('./pages/controls/scroll-column/scroll-column.page').then(
        (m) => m.ScrollColumnPage,
      ),
  },
  {
    path: 'controls/slider',
    loadComponent: () =>
      import('./pages/controls/slider/slider.page').then((m) => m.SliderPage),
  },
  {
    path: 'controls/segmented-control',
    loadComponent: () =>
      import('./pages/controls/segmented-control/segmented-control.page').then(
        (m) => m.SegmentedControlPage,
      ),
  },
  {
    path: 'controls/divider-and-spacer',
    loadComponent: () =>
      import('./pages/controls/divider-and-spacer/divider-and-spacer.page').then(
        (m) => m.DividerAndSpacerPage,
      ),
  },
  {
    path: 'controls/icon',
    loadComponent: () =>
      import('./pages/controls/icon/icon.page').then((m) => m.IconPage),
  },
  {
    path: 'controls/async-image',
    loadComponent: () =>
      import('./pages/controls/async-image/async-image.page').then(
        (m) => m.AsyncImagePage,
      ),
  },
  {
    path: 'controls/list-row',
    loadComponent: () =>
      import('./pages/controls/list-row/list-row.page').then(
        (m) => m.ListRowPage,
      ),
  },
  {
    path: 'controls/menu',
    loadComponent: () =>
      import('./pages/controls/menu/menu.page').then((m) => m.MenuPage),
  },
  {
    path: 'controls/section-header',
    loadComponent: () =>
      import('./pages/controls/section-header/section-header.page').then(
        (m) => m.SectionHeaderPage,
      ),
  },
  {
    path: 'controls/stepper',
    loadComponent: () =>
      import('./pages/controls/stepper/stepper.page').then(
        (m) => m.StepperPage,
      ),
  },
  {
    path: 'controls/sheet-headline',
    loadComponent: () =>
      import('./pages/controls/sheet-headline/sheet-headline.page').then(
        (m) => m.SheetHeadlinePage,
      ),
  },
  {
    path: 'controls/quick-actions',
    loadComponent: () =>
      import('./pages/controls/quick-actions/quick-actions.page').then(
        (m) => m.QuickActionsPage,
      ),
  },
  {
    path: 'controls/notice',
    loadComponent: () =>
      import('./pages/controls/notice/notice.page').then((m) => m.NoticePage),
  },
  {
    path: 'controls/metric',
    loadComponent: () =>
      import('./pages/controls/metric/metric.page').then((m) => m.MetricPage),
  },
  {
    path: 'controls/mark-scale',
    loadComponent: () =>
      import('./pages/controls/mark-scale/mark-scale.page').then(
        (m) => m.MarkScalePage,
      ),
  },
  {
    path: 'controls/gauge',
    loadComponent: () =>
      import('./pages/controls/gauge/gauge.page').then((m) => m.GaugePage),
  },
  {
    path: 'controls/streak-track',
    loadComponent: () =>
      import('./pages/controls/streak-track/streak-track.page').then(
        (m) => m.StreakTrackPage,
      ),
  },
  {
    path: 'controls/medal',
    loadComponent: () =>
      import('./pages/controls/medal/medal.page').then((m) => m.MedalPage),
  },
  {
    path: 'controls/date-tile',
    loadComponent: () =>
      import('./pages/controls/date-tile/date-tile.page').then(
        (m) => m.DateTilePage,
      ),
  },
  {
    path: 'controls/month-picker',
    loadComponent: () =>
      import('./pages/controls/month-picker/month-picker.page').then(
        (m) => m.MonthPickerPage,
      ),
  },
  {
    path: 'controls/coupon-card',
    loadComponent: () =>
      import('./pages/controls/coupon-card/coupon-card.page').then(
        (m) => m.CouponCardPage,
      ),
  },
  {
    path: 'controls/pass-card',
    loadComponent: () =>
      import('./pages/controls/pass-card/pass-card.page').then(
        (m) => m.PassCardPage,
      ),
  },
  /* Compositions — DS pieces put together the way a page puts them, for a
     look at real pixels. Listed on the controls index, in its own group. */
  {
    path: 'compositions/client-card',
    loadComponent: () =>
      import('./pages/compositions/client-card/client-card.page').then(
        (m) => m.ClientCardCompositionPage,
      ),
  },
];
