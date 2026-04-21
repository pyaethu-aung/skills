#!/usr/bin/env python3
"""Validates that every directory under skills/ contains a compliant SKILL.md."""

import os
import re
import sys

SKILLS_DIR = "skills"
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+")


def parse_frontmatter(path):
    with open(path) as f:
        content = f.read()

    if not content.startswith("---"):
        return None, content

    parts = content.split("---", 2)
    if len(parts) < 3:
        return None, content

    fm = {}
    current_section = None
    for line in parts[1].splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        if line.startswith("  ") and current_section is not None:
            # Nested key under current_section (e.g. metadata.version)
            key, _, value = line.strip().partition(":")
            if isinstance(fm.get(current_section), dict):
                fm[current_section][key.strip()] = value.strip().strip('"').strip("'")
        elif ":" in line:
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if value:
                fm[key] = value
                current_section = None
            else:
                # Block mapping (e.g. "metadata:")
                fm[key] = {}
                current_section = key

    return fm, parts[2].strip()


def validate_skill(skill_name):
    errors = []
    skill_md = os.path.join(SKILLS_DIR, skill_name, "SKILL.md")

    if not os.path.isfile(skill_md):
        return ["missing SKILL.md"]

    fm, body = parse_frontmatter(skill_md)

    if fm is None:
        return ["SKILL.md has no YAML frontmatter (must start with ---)"]

    # Required string fields
    for field in ("name", "description"):
        if not fm.get(field):
            errors.append(f"missing required field '{field}'")

    # name must match the directory name
    if fm.get("name") and fm["name"] != skill_name:
        errors.append(
            f"'name' is '{fm['name']}' but directory is '{skill_name}'"
        )

    # metadata.version must be present and semver-like
    meta = fm.get("metadata")
    if not isinstance(meta, dict) or not meta.get("version"):
        errors.append("missing metadata.version")
    else:
        version = str(meta["version"])
        if not SEMVER_RE.match(version):
            errors.append(
                f"metadata.version '{version}' is not semver (expected x.y.z)"
            )

    # Body must not be empty
    if not body:
        errors.append("SKILL.md has no body content after the frontmatter")

    return errors


def main():
    if not os.path.isdir(SKILLS_DIR):
        print(f"ERROR: '{SKILLS_DIR}' directory not found", file=sys.stderr)
        sys.exit(1)

    skill_dirs = sorted(
        d for d in os.listdir(SKILLS_DIR)
        if os.path.isdir(os.path.join(SKILLS_DIR, d))
    )

    if not skill_dirs:
        print("No skill directories found — nothing to validate.")
        sys.exit(0)

    all_errors = {}
    for skill_name in skill_dirs:
        errs = validate_skill(skill_name)
        all_errors[skill_name] = errs
        status = "✓" if not errs else "✗"
        print(f"  {status} {skill_name}")

    failed = {k: v for k, v in all_errors.items() if v}

    if failed:
        print(f"\n{len(failed)} skill(s) failed validation:")
        for skill_name, errs in failed.items():
            for e in errs:
                print(f"  {skill_name}: {e}")
        sys.exit(1)

    print(f"\nAll {len(skill_dirs)} skill(s) are valid.")


if __name__ == "__main__":
    main()
