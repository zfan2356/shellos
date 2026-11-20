# Remote Tode over direct HTTPS

The Mac renders Tode locally. The paired Linux host runs native code-server
with TLS and password authentication. Ordinary SSH starts the editor and
returns connection metadata; editor HTTP and WebSocket traffic uses the
host's internal address directly. There is no SSH port forwarding or SOCKS
proxy, and the remote machine receives no access to Kitty's control socket.

## Open a workspace

Run this command in a local Kitty shell:

```bash
tode-remote <ssh-alias> /absolute/remote/project
```

The default endpoint port is 8791. A third argument selects a different port.
Use `--check` to verify certificate validation, connectivity and login without
opening a window. The launcher uses the existing SSH host-key trust and
credentials; it never copies a private key or forwards an SSH agent.

In an existing remote SSH shell, use `pwd` to identify the directory, then
open it from the Mac. The remote `tode` wrapper prints this instruction and
exits. Maintenance commands such as `tode --version` still run remotely.
An SSH shortcut can export `TODE_SSH_ALIAS` for its interactive shell so the
instruction includes the exact local alias, for example
`tode-remote cvm "/root/wxg/mimikyu"`.
The retired `tode --ssh` and terminal-browser SSH transport fail explicitly.
Do not replace them with another tunnel when direct access is unavailable.

## Endpoint security and lifetime

The server binds only the address of the authenticated SSH connection, never
a wildcard. A dedicated iptables chain restricts that destination and port
to the server itself and clients that authenticated over SSH. Other host
firewall rules remain in effect. Deployment currently requires a Linux root
account and iptables. No firewall policy or unrelated port is opened.

On first launch the host creates its own private key, a one-year self-signed
certificate with its exact IP address in the SAN, and a random password.
Private files live under `~/.config/shellos/direct/<port>/` with owner-only
permissions. The private key stays on the server. The public certificate and
login password travel only inside the verified SSH channel.

The Mac validates the HTTPS server against that certificate and its hostname.
Its Electron session accepts only the exact certificate obtained through SSH,
and only for that host. HTTP and WebSocket authentication cookies are injected
only for the selected editor origin, never for another host, port or plaintext
HTTP. No system-wide CA changes or disabled certificate validation are used.
A private per-window script is deleted after the browser loads it.

Native code-server handles authentication, HTTPS and WebSocket upgrades.
Its general port-proxy feature is disabled. Tode styling and its font are
installed as native workbench assets; the remote editor does not use the old
CSS-injecting proxy. Existing extensions, review features and editor settings
use the same remote profile.

The server survives SSH disconnection but does not automatically start at
boot. The next local launch starts it again. Logs and process identity are
kept beside its config. Expired certificates and changed server addresses
fail closed and require deliberate reprovisioning. No automatic fallback
changes the transport.

## Deployment

All changes follow `skills/shellos/SKILL.md`: independent authoring checkout,
focused validation, commit and push, formal checkout pull, full reinstall:

```bash
./scripts/reinstall-shellos.sh <ssh-alias> [port]
```

The complete installer disables every `forward_remote_control` directive in
the private Kitty SSH config, preserving host aliases and login shells. The
new wildcard policy also defaults future hosts to no control forwarding.
Existing SSH sessions must be closed separately if they were opened under an
older configuration. Deployment SSH/SCP commands explicitly disable forwarding,
proxies, jump hosts and shared control connections.

Tode release archives are cached and their pinned checksums are rechecked on
every reinstall. The startup patch now targets the native CLI directly and
does not depend on the retired SSH reconnect patch.

The installer uses the pinned Kitty release archive and SHA-256 even when
Homebrew's current catalog is newer. This keeps a transport fix from upgrading
Kitty implicitly. The checksum recorded for v0.49.2 is the previously installed
Homebrew release artifact; its application signature is verified before the swap.

## Verification

Run `python3 -B tests/tode-direct.test.py`,
`node --test tests/tode-direct-browser.test.cjs` and
`bash tests/tode-remote-wrapper.test.sh`. Also apply `patch-tode-direct.sh`
to a disposable release copy and verify its `--check` mode.

After deployment verify the native HTTPS listener, source-restricted firewall
chain, unauthenticated rejection, authenticated workbench and WebSocket,
certificate mismatch rejection (also exercised with the real Electron binary
by `tests/electron-direct-https.test.cjs`), real Kitty rendering and absence of new
SSH forwarding processes. A successful SSH bootstrap alone is not proof of
editor connectivity. If the internal service port is blocked, report that
network requirement without attempting a tunnel.
