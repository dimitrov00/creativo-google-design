// Test support for the landing's own specs — the authored demo catalogue
// served behind CATALOG_PORTS and the landing translations — as a testing
// entry point (`@creativo/features/marketing/landing/testing`), so a spec at
// any depth names it by alias instead of climbing `../../../` (Law 8.3).
export * from './testing/test-catalog.providers';
export * from './testing/test-i18n.providers';
