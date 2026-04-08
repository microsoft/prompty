#!/usr/bin/env python3
"""Validate documentation content against the Prompty v2 specification.

Scans MDX files for YAML code blocks containing prompty-style frontmatter
and validates property names. Also validates .prompty files in docs-examples.

Usage:
    python web/docs-examples/lint_docs.py
    python web/docs-examples/lint_docs.py --verbose
    python web/docs-examples/lint_docs.py --docs-dir web/src/content/docs --prompts-dir web/docs-examples/prompts
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml is required. Install with: pip install pyyaml", file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------------------
# Valid property sets per the Prompty v2 / AgentSchema spec
# ---------------------------------------------------------------------------

VALID_ROOT_PROPERTIES = {
    "name", "displayName", "description", "metadata",
    "model", "inputs", "outputs", "tools", "template",
}

VALID_MODEL_PROPERTIES = {
    "id", "provider", "apiType", "connection", "options",
}

VALID_CONNECTION_PROPERTIES = {
    "kind", "endpoint", "apiKey", "name", "target", "authenticationMode",
    # FoundryConnection extras
    "connectionType",
    # OAuthConnection extras
    "clientId", "clientSecret", "tokenUrl", "scopes",
}

VALID_OPTIONS_PROPERTIES = {
    "temperature", "maxOutputTokens", "frequencyPenalty", "presencePenalty",
    "seed", "topK", "topP", "stopSequences", "allowMultipleToolCalls",
    "additionalProperties",
}

VALID_INPUT_OUTPUT_ITEM_PROPERTIES = {
    "name", "kind", "description", "required", "default", "example", "enumValues",
    # Nested properties for kind: object
    "properties",
}

VALID_TEMPLATE_PROPERTIES = {"format", "parser"}
VALID_TEMPLATE_FORMAT_PROPERTIES = {"kind"}
VALID_TEMPLATE_PARSER_PROPERTIES = {"kind"}

VALID_TOOL_PROPERTIES = {
    "name", "kind", "description", "parameters", "connection", "specification",
    "serverName", "serverDescription", "approvalMode", "allowedTools",
    "options", "bindings", "strict", "source",
    # PromptyTool extras
    "path", "mode",
}

# Also allow `properties` inside inputs/outputs (the container for list-of-properties)
VALID_INPUT_OUTPUT_CONTAINER_PROPERTIES = {"properties", "examples", "strict"}

# ---------------------------------------------------------------------------
# Legacy property mappings — specific error messages
# ---------------------------------------------------------------------------

LEGACY_ROOT = {
    "inputSchema": "should be 'inputs'",
    "outputSchema": "should be 'outputs'",
}

LEGACY_MODEL = {
    "parameters": "should be 'options'",
    "configuration": "should be 'connection'",
    "api": "should be 'apiType'",
}

LEGACY_CONNECTION = {
    "api_key": "should be 'apiKey'",
    "azure_endpoint": "should be 'endpoint'",
    "azure_deployment": "should be 'model.id'",
}

# Inside old model.configuration
LEGACY_CONFIGURATION = {
    "type": "should be 'provider' on the model object",
}

LEGACY_OPTIONS = {
    "max_tokens": "should be 'maxOutputTokens'",
}

LEGACY_INPUT_ITEM = {
    "sample": "should be 'default'",
    "type": "should be 'kind'",
}


# ---------------------------------------------------------------------------
# Diagnostic
# ---------------------------------------------------------------------------

class Diagnostic:
    """A single validation issue."""

    def __init__(self, file: str, line: int | None, message: str, *, is_legacy: bool = False) -> None:
        self.file = file
        self.line = line
        self.message = message
        self.is_legacy = is_legacy

    def __str__(self) -> str:
        loc = self.file
        if self.line is not None:
            loc += f":{self.line}"
        kind = "legacy property" if self.is_legacy else "unknown property"
        return f"\u2717 {loc} \u2014 {kind} {self.message}"


# ---------------------------------------------------------------------------
# YAML code block extraction from MDX
# ---------------------------------------------------------------------------

# Matches fenced code blocks: ```yaml, ```prompty, ```yaml title="...", or plain ```
_CODE_BLOCK_RE = re.compile(
    r'^(?P<indent>[ \t]*)```(?P<lang>[a-zA-Z0-9_-]*)(?P<attrs>[^\n]*)\n'
    r'(?P<body>.*?)\n'
    r'(?P=indent)```',
    re.MULTILINE | re.DOTALL,
)

# Heuristic: a YAML block looks like prompty frontmatter if it contains
# at least one of these root-level keys (at column 0 relative to block).
_PROMPTY_HINT_KEYS = {
    "name", "displayName", "description", "metadata",
    "model", "inputs", "outputs", "tools", "template",
    # Legacy keys we also want to catch
    "inputSchema", "outputSchema",
}


def _is_prompty_yaml(body: str) -> bool:
    """Heuristic: does this YAML block look like prompty frontmatter?"""
    for line in body.splitlines():
        stripped = line.lstrip()
        # Skip comments
        if stripped.startswith("#"):
            continue
        # Check for root-level key (no leading whitespace or only after ---)
        match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*):', line)
        if match and match.group(1) in _PROMPTY_HINT_KEYS:
            return True
    return False


def _strip_frontmatter_delimiters(body: str) -> str:
    """Remove leading/trailing --- delimiters if present."""
    lines = body.strip().splitlines()
    if lines and lines[0].strip() == "---":
        lines = lines[1:]
    if lines and lines[-1].strip() == "---":
        lines = lines[:-1]
    # Also strip everything after a closing --- (the markdown body of a .prompty)
    result = []
    for line in lines:
        if line.strip() == "---":
            break
        result.append(line)
    return "\n".join(result)


def extract_yaml_blocks(filepath: Path, content: str) -> list[tuple[int, str]]:
    """Extract (line_number, yaml_text) pairs from MDX code blocks.

    Only returns blocks that look like prompty frontmatter.
    """
    blocks: list[tuple[int, str]] = []
    for m in _CODE_BLOCK_RE.finditer(content):
        lang = m.group("lang").lower()
        # Only consider yaml, prompty, or untagged blocks
        if lang and lang not in ("yaml", "prompty"):
            continue
        body = m.group("body")
        # For untagged blocks, apply a stricter heuristic
        if not lang and not _is_prompty_yaml(body):
            continue
        if lang in ("yaml", "prompty") and not _is_prompty_yaml(body):
            continue
        # Compute the line number (1-indexed) where the block content starts
        line_offset = content[: m.start()].count("\n") + 2  # +1 for 1-index, +1 for ``` line
        blocks.append((line_offset, body))
    return blocks


# ---------------------------------------------------------------------------
# .prompty file parsing
# ---------------------------------------------------------------------------

def parse_prompty_file(filepath: Path) -> str | None:
    """Read a .prompty file and return the frontmatter YAML (without body)."""
    text = filepath.read_text(encoding="utf-8")
    # Standard format: starts with ---, frontmatter, ---, body
    lines = text.strip().splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    fm_lines: list[str] = []
    for line in lines[1:]:
        if line.strip() == "---":
            break
        fm_lines.append(line)
    return "\n".join(fm_lines) if fm_lines else None


# ---------------------------------------------------------------------------
# Validation logic
# ---------------------------------------------------------------------------

def _check_unknown(
    keys: set[str],
    valid: set[str],
    legacy: dict[str, str],
    context: str,
    file: str,
    line: int | None,
    diagnostics: list[Diagnostic],
) -> None:
    """Check a set of keys against valid + legacy mappings."""
    for key in sorted(keys):
        if key in valid:
            continue
        if key in legacy:
            diagnostics.append(Diagnostic(
                file, line,
                f"'{key}' ({legacy[key]})",
                is_legacy=True,
            ))
        else:
            # Try to suggest a close match
            suggestion = _suggest(key, valid)
            msg = f"'{key}'" + (f" (did you mean '{suggestion}'?)" if suggestion else "")
            diagnostics.append(Diagnostic(file, line, msg + f" in {context}"))


def _suggest(key: str, valid: set[str]) -> str | None:
    """Simple suggestion: find a valid key that shares a significant prefix."""
    key_lower = key.lower().replace("_", "")
    for v in sorted(valid):
        if v.lower().replace("_", "") == key_lower:
            return v
    # Prefix match
    for v in sorted(valid):
        if v.lower().startswith(key_lower[:4]) or key_lower.startswith(v.lower()[:4]):
            return v
    return None


def _validate_connection(data: dict, file: str, line: int | None, diagnostics: list[Diagnostic]) -> None:
    """Validate connection properties."""
    if not isinstance(data, dict):
        return
    keys = set(data.keys())
    _check_unknown(keys, VALID_CONNECTION_PROPERTIES, LEGACY_CONNECTION, "connection", file, line, diagnostics)


def _validate_options(data: dict, file: str, line: int | None, diagnostics: list[Diagnostic]) -> None:
    """Validate model options properties."""
    if not isinstance(data, dict):
        return
    keys = set(data.keys())
    _check_unknown(keys, VALID_OPTIONS_PROPERTIES, LEGACY_OPTIONS, "model.options", file, line, diagnostics)


def _validate_model(data: dict, file: str, line: int | None, diagnostics: list[Diagnostic]) -> None:
    """Validate model section properties."""
    if not isinstance(data, dict):
        return  # Could be shorthand string like `model: gpt-4`
    keys = set(data.keys())
    _check_unknown(keys, VALID_MODEL_PROPERTIES, LEGACY_MODEL, "model", file, line, diagnostics)

    if "connection" in data:
        _validate_connection(data["connection"], file, line, diagnostics)
    # Also check legacy 'configuration' as if it were connection
    if "configuration" in data and isinstance(data["configuration"], dict):
        config_keys = set(data["configuration"].keys())
        _check_unknown(config_keys, VALID_CONNECTION_PROPERTIES, {**LEGACY_CONNECTION, **LEGACY_CONFIGURATION},
                        "model.configuration (legacy)", file, line, diagnostics)
    if "options" in data:
        _validate_options(data["options"], file, line, diagnostics)
    # Also check legacy 'parameters' as if it were options
    if "parameters" in data and isinstance(data["parameters"], dict):
        param_keys = set(data["parameters"].keys())
        _check_unknown(param_keys, VALID_OPTIONS_PROPERTIES, LEGACY_OPTIONS,
                        "model.parameters (legacy)", file, line, diagnostics)


def _validate_input_output_item(item: dict, context: str, file: str, line: int | None, diagnostics: list[Diagnostic]) -> None:
    """Validate a single input/output property item."""
    if not isinstance(item, dict):
        return
    keys = set(item.keys())
    _check_unknown(keys, VALID_INPUT_OUTPUT_ITEM_PROPERTIES, LEGACY_INPUT_ITEM, context, file, line, diagnostics)


def _validate_inputs_outputs(data, context: str, file: str, line: int | None, diagnostics: list[Diagnostic]) -> None:
    """Validate inputs or outputs section."""
    if isinstance(data, list):
        for item in data:
            _validate_input_output_item(item, context, file, line, diagnostics)
    elif isinstance(data, dict):
        # Could be dict-form: { properties: [...] } or old-style { name: {type: ..., sample: ...} }
        if "properties" in data:
            props = data["properties"]
            if isinstance(props, list):
                for item in props:
                    _validate_input_output_item(item, context, file, line, diagnostics)
            elif isinstance(props, dict):
                # Dict-keyed properties: { question: { kind: string } }
                for _name, prop in props.items():
                    if isinstance(prop, dict):
                        _validate_input_output_item(prop, context, file, line, diagnostics)
            # Validate container-level keys
            container_keys = set(data.keys())
            _check_unknown(container_keys, VALID_INPUT_OUTPUT_CONTAINER_PROPERTIES, {}, f"{context} container", file, line, diagnostics)
        else:
            # Old-style dict inputs: { name: { type: string, sample: "..." } }
            for _name, prop in data.items():
                if isinstance(prop, dict):
                    _validate_input_output_item(prop, context, file, line, diagnostics)
                # Scalar values like `question: "What is life?"` are fine — implicit string


def _validate_tool(tool: dict, file: str, line: int | None, diagnostics: list[Diagnostic]) -> None:
    """Validate a single tool entry."""
    if not isinstance(tool, dict):
        return
    keys = set(tool.keys())
    _check_unknown(keys, VALID_TOOL_PROPERTIES, {}, "tools item", file, line, diagnostics)

    # Validate nested connection in tool
    if "connection" in tool:
        _validate_connection(tool["connection"], file, line, diagnostics)

    # Validate parameters (PropertySchema — same as inputs)
    if "parameters" in tool:
        params = tool["parameters"]
        if isinstance(params, list):
            for item in params:
                _validate_input_output_item(item, "tool.parameters", file, line, diagnostics)
        elif isinstance(params, dict):
            if "properties" in params:
                props = params["properties"]
                if isinstance(props, list):
                    for item in props:
                        _validate_input_output_item(item, "tool.parameters", file, line, diagnostics)


def _validate_template(data, file: str, line: int | None, diagnostics: list[Diagnostic]) -> None:
    """Validate template section."""
    if isinstance(data, str):
        return  # Shorthand like `template: jinja2`
    if not isinstance(data, dict):
        return
    keys = set(data.keys())
    _check_unknown(keys, VALID_TEMPLATE_PROPERTIES, {}, "template", file, line, diagnostics)
    if "format" in data and isinstance(data["format"], dict):
        fmt_keys = set(data["format"].keys())
        _check_unknown(fmt_keys, VALID_TEMPLATE_FORMAT_PROPERTIES, {}, "template.format", file, line, diagnostics)
    if "parser" in data and isinstance(data["parser"], dict):
        parser_keys = set(data["parser"].keys())
        _check_unknown(parser_keys, VALID_TEMPLATE_PARSER_PROPERTIES, {}, "template.parser", file, line, diagnostics)


def validate_yaml(data: dict, file: str, line: int | None) -> list[Diagnostic]:
    """Validate a parsed YAML dict representing prompty frontmatter."""
    diagnostics: list[Diagnostic] = []
    if not isinstance(data, dict):
        return diagnostics

    # Root-level keys
    root_keys = set(data.keys())
    _check_unknown(root_keys, VALID_ROOT_PROPERTIES, LEGACY_ROOT, "root", file, line, diagnostics)

    # Model section
    if "model" in data:
        _validate_model(data["model"], file, line, diagnostics)

    # Inputs / outputs
    if "inputs" in data:
        _validate_inputs_outputs(data["inputs"], "inputs", file, line, diagnostics)
    if "outputs" in data:
        _validate_inputs_outputs(data["outputs"], "outputs", file, line, diagnostics)

    # Tools
    if "tools" in data and isinstance(data["tools"], list):
        for tool in data["tools"]:
            _validate_tool(tool, file, line, diagnostics)

    # Template
    if "template" in data:
        _validate_template(data["template"], file, line, diagnostics)

    return diagnostics


# ---------------------------------------------------------------------------
# Multi-document YAML handling
# ---------------------------------------------------------------------------

def _try_parse_yaml_docs(text: str) -> list[dict]:
    """Parse YAML text, handling multi-document blocks with v1/v2 comparisons.

    Some code blocks contain both v1 and v2 examples separated by comments
    like ``# v1`` / ``# v2``. We split on these and only validate v2 sections
    (v1 sections are intentionally showing legacy format).
    """
    results: list[dict] = []

    # If the block contains "# v1" and "# v2" markers, only parse v2 sections
    if re.search(r'^#\s*v[12]\b', text, re.MULTILINE):
        sections = re.split(r'^(?=#\s*v[12]\b)', text, flags=re.MULTILINE)
        for section in sections:
            section = section.strip()
            if not section:
                continue
            # Check if this is a v2 section
            header_match = re.match(r'^#\s*(v[12])\b', section)
            if header_match and header_match.group(1) != "v2":
                continue  # Skip v1 sections — they show legacy format intentionally
            # Remove the leading comment
            section = re.sub(r'^#\s*v[12][^\n]*\n?', '', section).strip()
            if section:
                try:
                    doc = yaml.safe_load(section)
                    if isinstance(doc, dict):
                        results.append(doc)
                except yaml.YAMLError:
                    pass
        return results

    # Normal parse
    try:
        doc = yaml.safe_load(text)
        if isinstance(doc, dict):
            results.append(doc)
    except yaml.YAMLError:
        pass

    return results


# ---------------------------------------------------------------------------
# File scanning
# ---------------------------------------------------------------------------

def scan_mdx_file(filepath: Path, repo_root: Path) -> tuple[int, list[Diagnostic]]:
    """Scan an MDX file for prompty YAML blocks and validate them.

    Returns (block_count, diagnostics).
    """
    rel_path = str(filepath.relative_to(repo_root)).replace("\\", "/")
    content = filepath.read_text(encoding="utf-8")
    blocks = extract_yaml_blocks(filepath, content)

    all_diagnostics: list[Diagnostic] = []
    valid_blocks = 0

    for line_num, body in blocks:
        # Strip frontmatter delimiters if present
        yaml_text = _strip_frontmatter_delimiters(body)
        docs = _try_parse_yaml_docs(yaml_text)
        if not docs:
            continue
        valid_blocks += 1
        for doc in docs:
            diags = validate_yaml(doc, rel_path, line_num)
            all_diagnostics.extend(diags)

    return valid_blocks, all_diagnostics


def scan_prompty_file(filepath: Path, repo_root: Path) -> list[Diagnostic]:
    """Validate a .prompty file's frontmatter."""
    rel_path = str(filepath.relative_to(repo_root)).replace("\\", "/")
    fm_text = parse_prompty_file(filepath)
    if fm_text is None:
        return [Diagnostic(rel_path, None, "could not parse frontmatter")]

    docs = _try_parse_yaml_docs(fm_text)
    all_diagnostics: list[Diagnostic] = []
    for doc in docs:
        all_diagnostics.extend(validate_yaml(doc, rel_path, None))
    return all_diagnostics


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Lint Prompty documentation for spec compliance.",
    )
    parser.add_argument(
        "--docs-dir",
        default="web/src/content/docs",
        help="Path to the MDX documentation directory (default: web/src/content/docs)",
    )
    parser.add_argument(
        "--prompts-dir",
        default="web/docs-examples/prompts",
        help="Path to the .prompty files directory (default: web/docs-examples/prompts)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show all files, including those with no issues",
    )
    args = parser.parse_args()

    # Resolve paths relative to the repo root (where the script is run from)
    repo_root = Path.cwd()
    docs_dir = (repo_root / args.docs_dir).resolve()
    prompts_dir = (repo_root / args.prompts_dir).resolve()

    # Directories to exclude from MDX scanning
    exclude_dirs = {"legacy", "specification"}

    total_errors = 0
    total_files = 0
    all_diagnostics: list[Diagnostic] = []

    # --- Scan MDX files ---
    if docs_dir.is_dir():
        mdx_files = sorted(docs_dir.rglob("*.mdx"))
        for mdx_file in mdx_files:
            # Check if any parent directory (relative to docs_dir) is excluded
            try:
                rel = mdx_file.relative_to(docs_dir)
            except ValueError:
                continue
            parts = rel.parts
            if any(p in exclude_dirs for p in parts):
                continue

            total_files += 1
            block_count, diagnostics = scan_mdx_file(mdx_file, repo_root)

            if diagnostics:
                all_diagnostics.extend(diagnostics)
                total_errors += len(diagnostics)
            elif args.verbose and block_count > 0:
                rel_path = str(mdx_file.relative_to(repo_root)).replace("\\", "/")
                block_word = "block" if block_count == 1 else "blocks"
                print(f"\u2713 {rel_path} \u2014 {block_count} code {block_word}, all valid")
            elif args.verbose:
                rel_path = str(mdx_file.relative_to(repo_root)).replace("\\", "/")
                print(f"\u2713 {rel_path} \u2014 no prompty code blocks")
    else:
        print(f"WARNING: docs directory not found: {docs_dir}", file=sys.stderr)

    # --- Scan .prompty files ---
    if prompts_dir.is_dir():
        prompty_files = sorted(prompts_dir.rglob("*.prompty"))
        for prompty_file in prompty_files:
            total_files += 1
            diagnostics = scan_prompty_file(prompty_file, repo_root)
            if diagnostics:
                all_diagnostics.extend(diagnostics)
                total_errors += len(diagnostics)
            elif args.verbose:
                rel_path = str(prompty_file.relative_to(repo_root)).replace("\\", "/")
                print(f"\u2713 {rel_path} \u2014 valid")
    else:
        print(f"WARNING: prompts directory not found: {prompts_dir}", file=sys.stderr)

    # --- Print diagnostics ---
    for diag in all_diagnostics:
        print(diag)

    # --- Summary ---
    print()
    if total_errors == 0:
        print(f"\u2713 All {total_files} files passed validation.")
        return 0
    else:
        error_word = "error" if total_errors == 1 else "errors"
        print(f"\u2717 {total_errors} {error_word} found across {total_files} files.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
