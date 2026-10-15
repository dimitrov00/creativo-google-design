// Test support for the landing's own specs — the bundled catalog fixture
// behind CATALOG_PORTS and the landing translations — as a testing entry
// point (`@creativo/features/marketing/landing/testing`), so a spec at any
// depth names it by alias instead of climbing `../../../` (Law 8.3).
export * from './lib/test-catalog.providers';
export * from './lib/test-i18n.providers';
