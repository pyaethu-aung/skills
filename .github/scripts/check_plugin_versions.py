#!/usr/bin/env python3
"""Fail when a plugin's content changed without a version bump.

Plugin content includes the symlinked sources (skills/, .claude/hooks/), not
just the plugin directory itself, because the installer dereferences the
symlinks: a change to a bundled skill IS a change to what the plugin ships.
A plugin absent from the base ref (its first release) never requires a bump.

Usage: check_plugin_versions.py [<base-ref>]   (default: origin/main)
"""
import json
import subprocess
import sys

PLUGIN_PATHS = {
    "git-workflow": [
        "plugins/git-workflow/",
        "skills/commit-message/",
        "skills/create-pr/",
        ".claude/hooks/",
    ],
    "web-dev": [
        "plugins/web-dev/",
        "skills/develop-web-feature/",
        "skills/update-readme/",
    ],
    "go-dev": [
        "plugins/go-dev/",
        "skills/develop-go-feature/",
        "skills/test-api/",
        "skills/postgres-scaffold/",
        "skills/update-readme/",
    ],
}
MARKETPLACE = ".claude-plugin/marketplace.json"


def git(*args):
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=True
    ).stdout


def show_json(ref, path):
    try:
        return json.loads(git("show", f"{ref}:{path}"))
    except subprocess.CalledProcessError:
        return None  # file absent at that ref


def plugin_version(data, name):
    if data is None:
        return None
    for entry in data.get("plugins", []):
        if entry.get("name") == name:
            return entry.get("version")
    return data.get("version") if data.get("name") == name else None


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "origin/main"
    changed = git("diff", "--name-only", f"{base}...HEAD").splitlines()

    failures = []
    for plugin, paths in PLUGIN_PATHS.items():
        touched = [f for f in changed if any(f.startswith(p) for p in paths)]
        if not touched:
            continue

        manifest = f"plugins/{plugin}/.claude-plugin/plugin.json"
        old_manifest = plugin_version(show_json(base, manifest), plugin)
        if old_manifest is None:
            continue  # first release of this plugin: no bump required

        new_manifest = plugin_version(show_json("HEAD", manifest), plugin)
        old_market = plugin_version(show_json(base, MARKETPLACE), plugin)
        new_market = plugin_version(show_json("HEAD", MARKETPLACE), plugin)

        if new_manifest == old_manifest:
            failures.append(
                f"{plugin}: {len(touched)} content file(s) changed but "
                f"plugin.json version is still {old_manifest}"
            )
        if old_market is not None and new_market == old_market:
            failures.append(
                f"{plugin}: {len(touched)} content file(s) changed but "
                f"marketplace.json version is still {old_market}"
            )
        if (
            new_manifest != old_manifest
            and new_market is not None
            and new_market != new_manifest
        ):
            failures.append(
                f"{plugin}: plugin.json ({new_manifest}) and marketplace.json "
                f"({new_market}) versions disagree"
            )

    for failure in failures:
        print(f"::error::{failure}")
    if failures:
        sys.exit(1)
    print("Plugin versions OK.")


if __name__ == "__main__":
    main()
