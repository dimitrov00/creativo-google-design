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
];
