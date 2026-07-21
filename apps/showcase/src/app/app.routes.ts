import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/gallery/gallery.page').then((m) => m.GalleryPage),
  },
  {
    path: 'tokens',
    loadComponent: () =>
      import('./pages/tokens/tokens.page').then((m) => m.TokensPage),
  },
  {
    path: 'cursor',
    loadComponent: () =>
      import('./pages/cursor-playground/cursor-playground.page').then(
        (m) => m.CursorPlaygroundPage,
      ),
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
    path: 'controls/input',
    loadComponent: () =>
      import('./pages/controls/input/input.page').then((m) => m.InputPage),
  },
  {
    path: 'controls/otp-field',
    loadComponent: () =>
      import('./pages/controls/otp-field/otp-field.page').then(
        (m) => m.OtpFieldPage,
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
    path: 'controls/spinner',
    loadComponent: () =>
      import('./pages/controls/spinner/spinner.page').then(
        (m) => m.SpinnerPage,
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
];
