#!/usr/bin/env python3
"""Preserve private host aliases while disabling Kitty remote-control forwarding."""
from pathlib import Path
import re
import sys


def configure(text):
    text = re.sub(r"(?m)^(\s*)forward_remote_control\s+.*$", r"\1forward_remote_control no", text)
    marker = "# ShellOS: no remote-control forwarding"
    if marker not in text:
        text = text.rstrip() + f"\n\n{marker}\nhostname *\nforward_remote_control no\n"
    return text


if __name__ == "__main__":
    path = Path(sys.argv[1])
    path.parent.mkdir(parents=True, exist_ok=True)
    text = path.read_text() if path.exists() else ""
    path.write_text(configure(text))
