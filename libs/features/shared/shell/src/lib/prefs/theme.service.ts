/**
 * The light/dark writer lives in the design system now
 * (`@creativo/ui/theme`, OR-47), over the tokens' pre-paint contract the
 * shell could not import. Re-exported here so the shell's toggle and every
 * screen importing it through `@creativo/features/shared/shell` keep their
 * import unchanged.
 */
export { ThemeService } from '@creativo/ui/theme';
