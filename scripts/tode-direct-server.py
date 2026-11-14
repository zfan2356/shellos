#!/usr/bin/env python3
"""Manage the authenticated, native code-server HTTPS endpoint on the SSH host."""
import argparse
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import secrets
import signal
import ssl
import subprocess
import time
import urllib.request


def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs)


def private_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def ssh_addresses():
    parts = os.environ.get("SSH_CONNECTION", "").split()
    if len(parts) != 4:
        raise ValueError("Run this helper through an authenticated direct SSH connection")
    client, server = (ipaddress.ip_address(parts[i]) for i in (0, 2))
    if client.version != 4 or server.version != 4 or server.is_loopback:
        raise ValueError("A directly reachable IPv4 interface is required")
    return str(client), str(server)


def restrict_source(bind, client, port):
    # RETURN preserves existing host firewall policy for allowed sources.
    chain = f"SHTODE{port}"
    ipt = "/usr/sbin/iptables"
    probe = subprocess.run([ipt, "-w", "-S", chain], capture_output=True)
    if probe.returncode:
        run(ipt, "-w", "-N", chain)
        run(ipt, "-w", "-A", chain, "-j", "REJECT", "--reject-with", "tcp-reset")
    for source in (bind, client):
        rule = ["-s", source, "-j", "RETURN"]
        if subprocess.run([ipt, "-w", "-C", chain, *rule], capture_output=True).returncode:
            run(ipt, "-w", "-I", chain, "1", *rule)
    jump = ["-p", "tcp", "-d", bind, "--dport", str(port), "-j", chain]
    if subprocess.run([ipt, "-w", "-C", "INPUT", *jump], capture_output=True).returncode:
        run(ipt, "-w", "-I", "INPUT", "1", *jump)


def code_server():
    roots = list((Path.home() / ".local/share/tode/code-server").glob("*/bin/code-server"))
    if not roots:
        raise RuntimeError("Install the pinned ShellOS code-server first")
    return max(roots, key=lambda p: tuple(int(x) for x in p.parents[1].name.split(".")))


def alive(state, config):
    try:
        pid = int(state["pid"])
        cmd = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        return os.fsencode(config) in cmd and os.kill(pid, 0) is None
    except (OSError, KeyError, ValueError):
        return False


def ready(url, cert):
    try:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=str(cert))),
        )
        with opener.open(url + "/healthz", timeout=2) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def ensure(port, project):
    client, bind = ssh_addresses()
    project = Path(project).expanduser().resolve(strict=True)
    if not project.is_dir():
        raise ValueError("The remote project must be a directory")
    root = Path.home() / ".config/shellos/direct" / str(port)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root.chmod(0o700)
    with (root / "lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        cert, key, config = root / "server.crt", root / "server.key", root / "server.json"
        identity_file = root / "identity.json"
        identity = json.loads(identity_file.read_text()) if identity_file.exists() else {}
        if identity and identity["bind"] != bind:
            raise RuntimeError("Server address changed; redeploy the direct endpoint explicitly")
        if not identity:
            run("openssl", "req", "-x509", "-newkey", "rsa:3072", "-sha256", "-nodes",
                "-days", "365", "-subj", "/CN=ShellOS Tode",
                "-addext", f"subjectAltName=IP:{bind}",
                "-addext", "basicConstraints=critical,CA:FALSE",
                "-keyout", str(key), "-out", str(cert))
            key.chmod(0o600)
            cert.chmod(0o600)
            identity = {"bind": bind, "password": secrets.token_urlsafe(48)}
            private_json(identity_file, identity)
        run("openssl", "x509", "-checkend", "86400", "-noout", "-in", str(cert))
        restrict_source(bind, client, port)
        server_config = {
            "bind-addr": f"{bind}:{port}",
            "auth": "password",
            "password": identity["password"],
            "cert": str(cert),
            "cert-key": str(key),
            "user-data-dir": str(Path.home() / ".local/share/tode/vscode/user-data"),
            "extensions-dir": str(Path.home() / ".local/share/tode/vscode/extensions"),
            "app-name": "tode",
            "disable-telemetry": True,
            "disable-update-check": True,
            "disable-proxy": True,
            "disable-getting-started-override": True,
            "ignore-last-opened": True,
        }
        private_json(config, server_config)
        state_file = root / "process.json"
        state = json.loads(state_file.read_text()) if state_file.exists() else {}
        url = f"https://{bind}:{port}"
        if not alive(state, config):
            with (root / "server.log").open("ab") as log:
                env = dict(os.environ)
                for name in ("PASSWORD", "HASHED_PASSWORD", "HTTP_PROXY", "HTTPS_PROXY",
                             "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
                    env.pop(name, None)
                process = subprocess.Popen(
                    [str(code_server()), "--config", str(config)],
                    stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                    start_new_session=True, env=env,
                )
            state = {"pid": process.pid}
            private_json(state_file, state)
        for _ in range(60):
            if ready(url, cert):
                # Returned only over the authenticated SSH stdout channel.
                return {"origin": url, "certificate": cert.read_text(),
                        "password": identity["password"], "folder": str(project)}
            if not alive(state, config):
                raise RuntimeError(f"code-server exited; inspect {root / 'server.log'}")
            time.sleep(0.5)
        raise RuntimeError("Native HTTPS code-server did not become ready")


def stop(port):
    root = Path.home() / ".config/shellos/direct" / str(port)
    state_file, config = root / "process.json", root / "server.json"
    if state_file.exists():
        state = json.loads(state_file.read_text())
        if alive(state, config):
            os.kill(state["pid"], signal.SIGTERM)
            for _ in range(40):
                if not alive(state, config):
                    break
                time.sleep(0.25)
            else:
                raise RuntimeError("Existing editor did not stop; refusing to replace it")
        state_file.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["ensure", "stop"])
    parser.add_argument("--port", type=int, default=8791)
    parser.add_argument("--folder", default="~")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Use an unprivileged TCP port")
    if args.action == "stop":
        stop(args.port)
    else:
        print(json.dumps(ensure(args.port, args.folder)))


if __name__ == "__main__":
    main()
