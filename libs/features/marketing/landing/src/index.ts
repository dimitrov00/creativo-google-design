export * from './lib/pages/home/home.page';
export * from './lib/test-i18n.providers';

// Site chrome (header/menu/footer, theme/locale prefs, icons) now lives in
// `@creativo/features/shared/shell` — re-exported here so nothing that
// previously imported these from `landing`'s own barrel breaks.
export * from '@creativo/features/shared/shell';
