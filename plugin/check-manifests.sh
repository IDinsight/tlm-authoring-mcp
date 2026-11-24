#!/usr/bin/env sh
# Fail if the plugin's per-tool manifests have drifted apart.
#
# The plugin ships one set of skills to several tools, and each tool reads its
# own manifest and server list: Claude (and Codex, which accepts Claude's) read
# .claude-plugin/plugin.json and .mcp.json; Antigravity reads
# .antigravity-plugin/plugin.json and mcp_config.json. They are copies, so a server
# added or a version bumped in one silently leaves the other tool behind.
#
# Usage:  ./check-manifests.sh        (from the plugin directory)
set -eu
exec python3 - <<'PY'
import json, os, sys

def load(path):
    if not os.path.isfile(path):
        sys.exit(f"check-manifests: '{path}' not found — run this from the plugin directory.")
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def servers(config, url_key):
    # Each tool names the address differently: "url" for Claude, "serverUrl" for Antigravity.
    return {name: entry.get(url_key) for name, entry in config.get("mcpServers", {}).items()}

claude = load(".claude-plugin/plugin.json")
antigravity = load(".antigravity-plugin/plugin.json")
claude_servers = servers(load(".mcp.json"), "url")
antigravity_servers = servers(load("mcp_config.json"), "serverUrl")

problems = []
for field in ("name", "version"):
    if claude.get(field) != antigravity.get(field):
        problems.append(f"{field}: Claude says {claude.get(field)!r}, Antigravity says {antigravity.get(field)!r}")
if claude_servers != antigravity_servers:
    problems.append(f"servers: .mcp.json has {claude_servers}, mcp_config.json has {antigravity_servers}")
if any(not url for url in claude_servers.values()):
    problems.append(f"servers: an entry in .mcp.json has no url: {claude_servers}")

if problems:
    print("The plugin's manifests disagree:\n")
    for problem in problems:
        print(f"  - {problem}")
    print("\nChange both copies together.")
    sys.exit(1)
print(f"OK — {claude['name']} {claude['version']}, {len(claude_servers)} servers, same for Claude and Antigravity")
PY
