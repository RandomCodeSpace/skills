#!/usr/bin/env python3
"""Generate a side-by-side comparison HTML for two iteration workspaces.

Usage:
    python compare.py <prev-iteration-dir> <curr-iteration-dir> --out <html-path>
"""
import argparse
import difflib
import html
from pathlib import Path

CSS = """
* { box-sizing: border-box; }
body {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  margin: 0;
  background: #0d1117;
  color: #c9d1d9;
  font-size: 13px;
  line-height: 1.5;
}
header {
  position: sticky; top: 0; z-index: 10;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  padding: 12px 24px;
  display: flex; align-items: center; gap: 16px;
}
header h1 { margin: 0; font-size: 15px; font-weight: 600; }
header .legend { margin-left: auto; font-size: 12px; color: #8b949e; }
header .legend .add { color: #3fb950; }
header .legend .rem { color: #f85149; }
nav.evals { padding: 8px 24px; background: #161b22; border-bottom: 1px solid #30363d;
  display: flex; gap: 4px; }
nav.evals button { background: transparent; color: #8b949e; border: 1px solid transparent;
  padding: 6px 14px; border-radius: 6px; font: inherit; cursor: pointer; }
nav.evals button.active { background: #21262d; color: #c9d1d9; border-color: #30363d; }
nav.files { padding: 8px 24px; background: #0d1117; border-bottom: 1px solid #30363d;
  display: flex; gap: 4px; flex-wrap: wrap; }
nav.files button { background: transparent; color: #8b949e; border: 1px solid #30363d;
  padding: 4px 10px; border-radius: 4px; font: inherit; font-size: 12px; cursor: pointer; }
nav.files button.active { background: #1f6feb22; color: #58a6ff; border-color: #1f6feb; }
nav.files button.added { color: #3fb950; border-color: #3fb95044; }
nav.files button.removed { color: #f85149; border-color: #f8514944; }
nav.files button.same { color: #6e7681; }
.eval-pane { display: none; }
.eval-pane.active { display: block; }
.file-pane { display: none; padding: 0; }
.file-pane.active { display: block; }
.diff-meta { padding: 12px 24px; color: #8b949e; font-size: 12px;
  background: #161b22; border-bottom: 1px solid #30363d; }
.diff-meta b { color: #c9d1d9; }
.diff-wrap { padding: 0; overflow-x: auto; }
table.diff { border-collapse: collapse; width: 100%; font: inherit; }
table.diff td { padding: 1px 8px; vertical-align: top; white-space: pre-wrap;
  word-break: break-word; }
table.diff td.diff_header { background: #161b22; color: #6e7681; text-align: right;
  width: 50px; user-select: none; border-right: 1px solid #30363d; }
table.diff td.diff_next { display: none; }
.diff_add { background-color: #033a16; color: #aff5b4; }
.diff_chg { background-color: #341a00; color: #f9b486; }
.diff_sub { background-color: #67060c; color: #ffdcd7; }
table.diff thead th { background: #161b22; padding: 8px 16px; text-align: left;
  border-bottom: 1px solid #30363d; color: #c9d1d9; font-weight: 600;
  position: sticky; top: 50px; z-index: 5; }
table.diff colgroup col:nth-child(1), table.diff colgroup col:nth-child(4) { width: 50px; }
table.diff colgroup col:nth-child(2), table.diff colgroup col:nth-child(3) { display: none; }
.empty-state { padding: 32px; text-align: center; color: #6e7681; }
.summary-pane { padding: 16px 24px; }
.summary-pane h3 { margin: 0 0 8px; font-size: 13px; color: #c9d1d9; }
.summary-pane ul { margin: 0 0 16px; padding-left: 20px; }
.summary-pane li { color: #8b949e; }
"""

JS = """
function show(eid, fid) {
  document.querySelectorAll('.eval-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav.evals button').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById('eval-' + eid);
  pane.classList.add('active');
  document.querySelector(`nav.evals button[data-eval="${eid}"]`).classList.add('active');
  if (fid) showFile(eid, fid);
  else {
    const firstFile = pane.querySelector('nav.files button');
    if (firstFile) firstFile.click();
  }
}
function showFile(eid, fid) {
  const pane = document.getElementById('eval-' + eid);
  pane.querySelectorAll('.file-pane').forEach(p => p.classList.remove('active'));
  pane.querySelectorAll('nav.files button').forEach(b => b.classList.remove('active'));
  pane.querySelector(`#file-${eid}-${fid}`).classList.add('active');
  pane.querySelector(`nav.files button[data-file="${fid}"]`).classList.add('active');
}
window.addEventListener('DOMContentLoaded', () => {
  const firstEval = document.querySelector('nav.evals button');
  if (firstEval) firstEval.click();
});
"""


def slugify(s: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in s).strip("-")


def render_diff(prev_text: str, curr_text: str) -> str:
    differ = difflib.HtmlDiff(wrapcolumn=120, tabsize=4)
    table = differ.make_table(
        prev_text.splitlines(),
        curr_text.splitlines(),
        fromdesc="iteration-2 (previous)",
        todesc="iteration-3 (current)",
        context=False,
    )
    return table


def file_diff_status(prev: str, curr: str) -> str:
    if not prev and curr: return "added"
    if prev and not curr: return "removed"
    if prev == curr: return "same"
    return "changed"


def collect_eval_files(eval_dir_prev: Path, eval_dir_curr: Path):
    """Return ordered (rel_path, prev_text, curr_text, status) tuples."""
    base_prev = eval_dir_prev / "with_skill" / "outputs"
    base_curr = eval_dir_curr / "with_skill" / "outputs"
    files = set()
    if base_prev.exists():
        files |= {p.relative_to(base_prev) for p in base_prev.rglob("*") if p.is_file()}
    if base_curr.exists():
        files |= {p.relative_to(base_curr) for p in base_curr.rglob("*") if p.is_file()}
    out = []
    for rel in sorted(files, key=str):
        prev_text = ""
        curr_text = ""
        prev_path = base_prev / rel
        curr_path = base_curr / rel
        if prev_path.exists():
            prev_text = prev_path.read_text(errors="replace")
        if curr_path.exists():
            curr_text = curr_path.read_text(errors="replace")
        out.append((str(rel), prev_text, curr_text, file_diff_status(prev_text, curr_text)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prev")
    ap.add_argument("curr")
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="project-summarizer: v2 → v3 comparison")
    args = ap.parse_args()

    prev = Path(args.prev)
    curr = Path(args.curr)

    eval_names = sorted({d.name for d in curr.iterdir() if d.is_dir() and d.name.startswith("eval-")} |
                        {d.name for d in prev.iterdir() if d.is_dir() and d.name.startswith("eval-")})

    parts = []
    parts.append(f"<!doctype html><meta charset='utf-8'><title>{html.escape(args.title)}</title>")
    parts.append(f"<style>{CSS}</style>")
    parts.append(f"<header><h1>{html.escape(args.title)}</h1>"
                 f"<span class='legend'>"
                 f"<span class='add'>■ added</span>&nbsp;&nbsp;"
                 f"<span class='rem'>■ removed</span>&nbsp;&nbsp;"
                 f"<span style='color:#f9b486'>■ changed</span>"
                 f"</span></header>")
    parts.append("<nav class='evals'>")
    for name in eval_names:
        parts.append(f"<button data-eval='{name}' onclick=\"show('{name}', null)\">{html.escape(name)}</button>")
    parts.append("</nav>")

    for ename in eval_names:
        files = collect_eval_files(prev / ename, curr / ename)
        parts.append(f"<div class='eval-pane' id='eval-{ename}'>")
        added = sum(1 for _, _, _, s in files if s == "added")
        removed = sum(1 for _, _, _, s in files if s == "removed")
        changed = sum(1 for _, _, _, s in files if s == "changed")
        same = sum(1 for _, _, _, s in files if s == "same")
        parts.append(f"<div class='diff-meta'><b>{ename}</b> — "
                     f"{added} added, {removed} removed, {changed} changed, {same} unchanged</div>")
        parts.append("<nav class='files'>")
        for rel, _, _, status in files:
            slug = slugify(rel)
            parts.append(f"<button class='{status}' data-file='{slug}' "
                         f"onclick=\"showFile('{ename}', '{slug}')\">{html.escape(rel)} "
                         f"<span style='opacity:0.6;font-size:11px'>· {status}</span></button>")
        parts.append("</nav>")
        for rel, prev_text, curr_text, status in files:
            slug = slugify(rel)
            parts.append(f"<div class='file-pane' id='file-{ename}-{slug}'>")
            if status == "same":
                parts.append(f"<div class='empty-state'>No changes in <b>{html.escape(rel)}</b></div>")
            elif status == "added":
                parts.append(f"<div class='diff-meta'><b>{html.escape(rel)}</b> — file added in iteration-3 ({len(curr_text.splitlines())} lines)</div>")
                parts.append(f"<div class='diff-wrap'><pre style='padding:16px;color:#aff5b4;background:#03260e'>{html.escape(curr_text)}</pre></div>")
            elif status == "removed":
                parts.append(f"<div class='diff-meta'><b>{html.escape(rel)}</b> — file removed in iteration-3 (was {len(prev_text.splitlines())} lines)</div>")
                parts.append(f"<div class='diff-wrap'><pre style='padding:16px;color:#ffdcd7;background:#440a0e'>{html.escape(prev_text)}</pre></div>")
            else:
                parts.append("<div class='diff-wrap'>")
                parts.append(render_diff(prev_text, curr_text))
                parts.append("</div>")
            parts.append("</div>")
        parts.append("</div>")

    parts.append(f"<script>{JS}</script>")
    Path(args.out).write_text("\n".join(parts))
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
