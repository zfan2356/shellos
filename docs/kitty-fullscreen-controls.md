# Transparent fullscreen with window controls

`macos_traditional_fullscreen yes` keeps the desktop visible through Kitty's
configured background opacity. ShellOS adds a Cocoa child panel containing
native close, minimize, and exit-fullscreen buttons. Moving to the top eight
points of the window reveals the panel; moving below it hides it. The panel
sits below the menu bar and accounts for the display's safe-area gap.

The panel cannot become the key window. It does not change the terminal's
OpenGL view, opacity, frame, or keyboard focus. It stays hidden during a drag
and while another application or window is active. Close sends the existing
GLFW close request, so Kitty still decides whether running commands require
confirmation. Minimize exits fullscreen first. The green button uses Kitty's
existing fullscreen callback, including window-size restoration.

The controller samples pointer position every 100 ms in common run-loop modes
while traditional fullscreen is enabled. This also works when the macOS menu
bar consumes mouse events. Exiting fullscreen or destroying the window
invalidates the timer and removes the child panel.

## Source and packaging

- `kitty/fullscreen-controls.m` contains the Cocoa controller.
- `kitty/fullscreen-controls.patch` attaches it to the pinned GLFW lifecycle.
- `scripts/build-kitty-cocoa.sh` applies the patch to a temporary archive of
  the exact Kitty submodule commit and builds its arm64 Cocoa backend.
- `scripts/build-kitty-app.sh` copies a signature-verified app of the pinned
  version to a new destination, replaces that backend, and signs the staged
  app locally. Existing application bundles are never modified by this script.
- The complete installer obtains the checksum-verified pinned release and
  uses this staging path before replacing the installed app.

The app contains `Contents/Resources/shellos-cocoa-build.txt` with its upstream
commit, ShellOS commit, backend checksum, and patch-source checksums.
This is a local arm64 build, not an upstream signed/notarized Kitty release.
macOS permissions tied to application signing identity may need reapproval.
Keep the installer's original app backup for rollback.

If the original app carries quarantine metadata, macOS can reject the locally
signed copy with an unknown-certificate/adhoc-signing error even when
`codesign --verify --deep --strict` succeeds. Staging does not remove quarantine
or change Gatekeeper policy. Approve the custom app through macOS Privacy &
Security before its first launch; the installer runs a version smoke check
before replacing the live app and stops if execution is denied.

## Validation

Run in a development checkout with the pinned Kitty submodule available:

```sh
bash scripts/build-kitty-cocoa.sh /tmp/shellos-test/kitty.glfw-cocoa.so
bash tests/kitty-fullscreen-controls.test.sh /tmp/shellos-test/kitty.glfw-cocoa.so
bash scripts/build-kitty-app.sh /Applications/kitty.app /tmp/shellos-test/kitty.app
```

The controller test covers hover boundaries, drag suppression, focus loss,
button actions, and timer cleanup. The integration test loads the built
backend, creates an invisible transparent OpenGL window, exercises the close
request and fullscreen callback, and checks cleanup on exit and destruction.

After installing and restarting Kitty, manually check a transparent fullscreen
window: reveal the controls from the top edge, move onto each button, leave the
strip, and verify the close confirmation with a running foreground command.
Also check display changes and a display with a notch when available.
