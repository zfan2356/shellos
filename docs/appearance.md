# IDEA Dark appearance

ShellOS uses the neutral surfaces and syntax colors from JetBrains' built-in
Dark theme. The reference files are
[expUI_dark.theme.json](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-resources/src/themes/expUI/expUI_dark.theme.json)
and [expUI_darkScheme.xml](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-resources/src/themes/expUI/expUI_darkScheme.xml).
The terminal ANSI palette is adapted to match those colors.

The editor and terminal backgrounds are `#1E1F22`. Toolbars and sidebars use
`#2B2D30`, separators use `#393B40`, and focused controls use `#3574F0`.
Kitty shares the same base color while retaining its existing 0.82 opacity and
background blur of 30. Color changes do not alter the transparent window style.
Syntax uses orange keywords, green strings, cyan numbers, blue declarations,
and muted comments. Ordinary identifiers and function calls stay neutral.

Keep these sources consistent when changing the appearance:

- `kitty/current-theme.conf` and `kitty/kitty.conf` define terminal colors and opacity.
- `tode/theme/palette.json` contains the equivalent terminal palette.
- `tode/theme/live-theme.json` contains the complete editor theme.
- `editor/settings.json` applies the same UI, TextMate, and semantic colors.
- `tode/theme/inject.css` sets the initial page background before the editor loads.

The complete installer copies the theme directory and palette to both hosts.
The canonical-theme patch makes Tode read `theme/live-theme.json` when building
its startup profile, and fingerprints the complete theme rather than only
the terminal palette. Reopening a window therefore preserves the chosen UI
and syntax colors. Installations without that file retain Tode's upstream
palette-based behavior. A malformed canonical theme fails visibly.

Validate changes in a disposable installation with
`node tests/tode-theme.test.cjs`, then follow the normal commit, push, pull,
and complete reinstall workflow. Live installation files are generated outputs.
