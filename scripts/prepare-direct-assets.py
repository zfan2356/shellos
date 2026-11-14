#!/usr/bin/env python3
"""Install Tode's stylesheet into native code-server, without an injecting proxy."""
from pathlib import Path
import shutil
import sys


def prepare(home):
    data = home / ".local/share/tode"
    servers = list((data / "code-server").glob("*/lib/vscode/out/vs/code/browser/workbench"))
    for workbench in servers:
        css = (data / "inject.css").read_text()
        css = css.replace('"/__tode/font.ttf"', '"shellos-font.ttf"')
        (workbench / "shellos-tode.css").write_text(css)
        font = home / ".local/lib/tode/assets/fonts/JetBrainsMono-Regular.ttf"
        shutil.copy2(font, workbench / "shellos-font.ttf")
        page = workbench / "workbench.html"
        html = page.read_text()
        link = '<link rel="stylesheet" href="{{WORKBENCH_WEB_BASE_URL}}/out/vs/code/browser/workbench/shellos-tode.css">'
        if link not in html:
            if "</head>" not in html:
                raise RuntimeError("Native workbench HTML no longer has a head element")
            page.write_text(html.replace("</head>", link + "\n</head>", 1))
    if not servers:
        raise RuntimeError("No prepared code-server workbench found")


if __name__ == "__main__":
    prepare(Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home())
