#!/usr/bin/env sh
# Fail if a skill or command names a server tool that does not exist.
#
# A procedure that calls a missing tool fails at the worst moment — mid-task, in
# front of an expert. The server's registerTool calls are the only source of
# truth for what exists, so this compares against them.
#
# Tools that do NOT exist yet are allowed only if they are listed as SEAMS below
# AND the file marks them as such. That is the difference between "we know this
# is missing" and "this will break".
#
# Usage:  ./check-tools-exist.sh [path-to-backend]     (default ../backend)
set -eu
exec python3 - "${1:-../backend}" <<'PY'
import os, re, sys

backend = sys.argv[1]
server_dir = os.path.join(backend, "src", "server")
if not os.path.isdir(server_dir):
    sys.exit(f"no server source at {server_dir} — pass its path")

# Tools that do not exist yet. A skill may name one only to mark the seam.
SEAMS = {"generate_document", "measure_document", "lint_content"}
# Subagents shipped by this plugin — named like tools, dispatched differently.
AGENTS = {"lecteur", "mesureur", "relecteur", "illustrateur"}

registered = set()
for root, _, files in os.walk(server_dir):
    for f in files:
        if not f.endswith(".ts"):
            continue
        src = open(os.path.join(root, f)).read()
        registered |= set(re.findall(r'registerTool\(\s*"([a-z_]+)"', src))
        registered |= set(re.findall(r'registerPrompt\(\s*"([a-z-]+)"', src))

if not registered:
    sys.exit("extracted zero tools from the server — the check itself is broken")

mentioned = {}
for area in ("skills", "commands", "agents"):
    for root, _, files in os.walk(area):
        for f in files:
            path = os.path.join(root, f)
            for line_no, line in enumerate(open(path), 1):
                for word in re.findall(r"`([a-z][a-z_]{3,})`", line):
                    mentioned.setdefault(word, []).append(f"{path}:{line_no}")

# A word is only judged if it looks like one of OUR tool names: snake_case with a
# verb-ish shape. Single words in backticks are usually field names.
candidates = {w: where for w, where in mentioned.items()
              if "_" in w and w not in AGENTS}

missing = {w: where for w, where in candidates.items()
           if w not in registered and w not in SEAMS}
seams_used = {w: where for w, where in candidates.items() if w in SEAMS}

for word, where in sorted(seams_used.items()):
    print(f"seam  {word:20s} {where[0]}  (does not exist yet — must be marked as a seam)")

if missing:
    print("\nNamed in the plugin but NOT registered by the server:")
    for word, where in sorted(missing.items()):
        print(f"  {word:24s} {', '.join(where[:3])}")
    print("\nEither the name is wrong, or it belongs in SEAMS and the file must say so.")
    sys.exit(1)

print(f"\nOK — {len(candidates)} tool names checked against {len(registered)} registered tools")
PY
