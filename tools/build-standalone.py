"""Build a single, self-contained HTML file for Crown & Oak.

The modular source under js/, css/ and vendor/ is convenient to develop with,
but ES modules cannot be opened directly from a phone or from a file:// URL.
This script inlines the stylesheet, fonts, Three.js and every game module into
one portable CrownAndOak.html that runs offline on any modern browser.

Usage:
    python tools/build-standalone.py
"""

from __future__ import annotations

import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "CrownAndOak.html"
WORKER_OUTPUT = ROOT / "js" / "ai-worker.generated.js"

# Modules are registered in dependency order. Each one runs inside its own
# factory so that top-level names (Three's internal `clamp`, for example) never
# collide with the game's names.
MODULES = [
    ("three", "vendor/three.module.js"),
    ("roundedBox", "vendor/RoundedBoxGeometry.js"),
    ("engine", "js/engine.js"),
    ("utils", "js/render/utils.js"),
    ("pieces", "js/render/pieces.js"),
    ("highlights", "js/render/highlights.js"),
    ("board", "js/render/board.js"),
    ("scene", "js/render/CheckersScene.js"),
    ("ai", "js/ai.js"),
    ("ai-client", "js/ai-client.js"),
    ("audio", "js/audio.js"),
    ("net", "js/net.js"),
    ("main", "js/main.js"),
]

IMPORT_RE = re.compile(
    r"^[ \t]*import\s+(?P<clause>[\s\S]*?)\s+from\s+(?P<path>['\"][^'\"]+['\"])\s*;?[ \t]*$",
    re.MULTILINE,
)
EXPORT_LIST_RE = re.compile(r"^[ \t]*export\s*\{(?P<items>[\s\S]*?)\}\s*;[ \t]*$", re.MULTILINE)
EXPORT_DECL_RE = re.compile(
    r"^(?P<lead>[ \t]*)export\s+"
    r"(?P<decl>(?:async\s+)?(?:const|let|var|function|class)\s+(?P<name>[A-Za-z_$][\w$]*))",
    re.MULTILINE,
)
FONT_URL_RE = re.compile(r"url\(['\"](\.\./vendor/fonts/[^'\"]+)['\"]\)")

MODULE_IDS = {
    (ROOT / rel).resolve(): module_id for module_id, rel in MODULES
}


def module_source(module_id: str, rel_path: str) -> str:
    path = (ROOT / rel_path).resolve()
    source = path.read_text(encoding="utf-8")
    if rel_path == "js/main.js":
        # Supabase is only bundled into the hosted build. The standalone file
        # has no credentials, so the dormant dynamic import becomes a stub.
        source = source.replace(
            "await import('./supabase-net.js')",
            "await __importSupabaseNet()",
        )
    exports: list[str] = []

    def replace_import(match: re.Match[str]) -> str:
        specifier = match.group("path")[1:-1]
        dependency = (path.parent / specifier).resolve()
        dependency_id = MODULE_IDS.get(dependency)
        if dependency_id is None:
            raise SystemExit(f"{rel_path}: unknown import {specifier!r}")

        clause = " ".join(match.group("clause").split())
        if clause.startswith("*"):
            local = clause.split("as", 1)[1].strip()
            return f"const {local} = __modules[{dependency_id!r}];"
        if clause.startswith("{"):
            entries = []
            for entry in clause.strip("{} ").split(","):
                entry = entry.strip()
                if not entry:
                    continue
                if " as " in entry:
                    original, local = (piece.strip() for piece in entry.split(" as ", 1))
                    entries.append(f"{original}: {local}")
                else:
                    entries.append(entry)
            return f"const {{ {', '.join(entries)} }} = __modules[{dependency_id!r}];"
        return f"const {clause} = __modules[{dependency_id!r}].default;"

    source = IMPORT_RE.sub(replace_import, source)

    def collect_export_list(match: re.Match[str]) -> str:
        for entry in match.group("items").split(","):
            entry = entry.strip()
            if not entry:
                continue
            if " as " in entry:
                local, public = (piece.strip() for piece in entry.split(" as ", 1))
                exports.append(f"{public}: {local}")
            else:
                exports.append(entry)
        return ""

    source = EXPORT_LIST_RE.sub(collect_export_list, source)

    def strip_export_decl(match: re.Match[str]) -> str:
        exports.append(match.group("name"))
        return match.group("lead") + match.group("decl")

    source = EXPORT_DECL_RE.sub(strip_export_decl, source)

    leftover = re.search(r"^[ \t]*(?:import|export)\b", source, re.MULTILINE)
    if leftover:
        line = source[: leftover.start()].count("\n") + 1
        raise SystemExit(f"{rel_path}:{line}: module statement left after transform")

    if exports:
        names = ", ".join(exports)
        source += f"\nObject.assign(exports, {{ {names} }});\n"

    return f"  __register({module_id!r}, function (exports) {{\n{source}\n  }});\n"


def strip_worker_module(rel_path: str) -> str:
    """Turn a game module into plain script code for the AI worker."""

    path = (ROOT / rel_path).resolve()
    source = path.read_text(encoding="utf-8")
    source = IMPORT_RE.sub(lambda match: "", source)
    source = EXPORT_LIST_RE.sub(lambda match: "", source)
    source = EXPORT_DECL_RE.sub(
        lambda match: match.group("lead") + match.group("decl"),
        source,
    )
    leftover = re.search(r"^[ \t]*(?:import|export)\b", source, re.MULTILINE)
    if leftover:
        line = source[: leftover.start()].count("\n") + 1
        raise SystemExit(f"{rel_path}:{line}: module statement left in worker source")
    return source


WORKER_HANDLER = """
self.onmessage = function (event) {
  var message = event.data || {};
  var id = message.id;
  try {
    var move = message.type === 'hint'
      ? chooseHint(message.board, message.color, message.timeLimit)
      : chooseMove(message.board, message.color, message.difficulty, {
          timeLimit: message.timeLimit,
        });
    self.postMessage({ id: id, move: move || null });
  } catch (error) {
    self.postMessage({ id: id, error: (error && error.message) || String(error) });
  }
};
"""


def build_ai_worker_source() -> str:
    """Create a dependency-free classic worker from engine.js and ai.js."""

    engine = strip_worker_module("js/engine.js")
    ai = strip_worker_module("js/ai.js")
    return (
        "// Generated by tools/build-standalone.py - do not edit by hand.\n"
        "'use strict';\n\n"
        f"{engine}\n\n{ai}\n\n{WORKER_HANDLER}"
    )


def build_styles() -> str:
    css = (ROOT / "css" / "styles.css").read_text(encoding="utf-8")

    def inline_font(match: re.Match[str]) -> str:
        font_path = (ROOT / "css" / match.group(1)).resolve()
        data = base64.b64encode(font_path.read_bytes()).decode("ascii")
        return f"url('data:font/woff2;base64,{data}')"

    css = FONT_URL_RE.sub(inline_font, css)
    return css


def main() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = build_styles()
    worker_source = build_ai_worker_source()
    WORKER_OUTPUT.write_text(worker_source, encoding="utf-8")

    modules = "\n".join(module_source(module_id, rel_path) for module_id, rel_path in MODULES)
    bundle = (
        "/* Crown & Oak - generated standalone build. Source lives in js/. */\n"
        "(function () {\n"
        "  'use strict';\n"
        f"  const __STANDALONE_AI_WORKER_SOURCE__ = {json.dumps(worker_source)};\n"
        "  const __SUPABASE_CONFIG__ = {};\n"
        "  async function __importSupabaseNet() {\n"
        "    throw new Error('Supabase online play is only available in the hosted build.');\n"
        "  }\n"
        "  const __modules = Object.create(null);\n"
        "  function __register(id, factory) {\n"
        "    const exports = {};\n"
        "    __modules[id] = exports;\n"
        "    factory(exports);\n"
        "  }\n\n"
        f"{modules}"
        "})();\n"
    )

    stylesheet_tag = '<link rel="stylesheet" href="css/styles.css" />'
    if stylesheet_tag not in html:
        raise SystemExit("index.html: stylesheet tag not found")
    html = html.replace(stylesheet_tag, f"<style>\n{css}\n</style>", 1)

    script_tag = '<script type="module" src="js/main.js"></script>'
    if script_tag not in html:
        raise SystemExit("index.html: module script tag not found")
    html = html.replace(script_tag, f"<script>\n{bundle}</script>", 1)

    OUTPUT.write_text(html, encoding="utf-8")
    size = OUTPUT.stat().st_size
    print(f"Wrote {OUTPUT} ({size / 1024 / 1024:.2f} MiB)")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - surface a useful build error
        print(f"Build failed: {error}", file=sys.stderr)
        raise
