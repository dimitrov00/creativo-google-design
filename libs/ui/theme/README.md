# ui-theme

`ThemeService`, the one runtime writer of the light/dark appearance (OR-47):
the `data-theme` attribute, the `ui-theme` storage key and
`<meta name="theme-color">`, every value read from the pre-paint contract of
`@creativo/ui/tokens`. It saves only an explicit choice and follows the
system appearance until one is made. Its own entry, kept tiny, because the
web app starts it at boot from the initial chunk. Imported as
`@creativo/ui/theme`; the shell re-exports it for the features.
