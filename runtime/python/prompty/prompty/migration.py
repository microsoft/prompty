"""Legacy migration — converts old-format Prompty properties to AgentSchema names.

This module is a backward-compatibility shim. Once v1 ``.prompty`` files are
fully phased out, this entire module can be deleted.
"""

from __future__ import annotations

import warnings
from typing import Any

__all__ = ["migrate"]


def migrate(data: dict[str, Any]) -> dict[str, Any]:
    """Convert old-format Prompty properties to AgentSchema names.

    Each conversion emits a ``DeprecationWarning``.  Returns the mutated
    *data* dict.
    """

    # --- model.configuration → model.connection (+ type splitting) ---
    model = data.get("model", {})
    if isinstance(model, str):
        # shorthand: model: gpt-4 → model: {id: gpt-4}
        data["model"] = {"id": model}
        return data
    if not isinstance(model, dict):
        return data

    # model.api → model.apiType
    if "api" in model and "apiType" not in model:
        _deprecation("model.api", "model.apiType")
        model["apiType"] = model.pop("api")

    # model.configuration → model.connection
    if "configuration" in model and "connection" not in model:
        config = model.pop("configuration")
        _deprecation("model.configuration", "model.connection")

        if isinstance(config, dict):
            conn_type = config.pop("type", None)
            if conn_type == "azure_openai":
                _deprecation("model.configuration.type: azure_openai", "model.provider: azure")
                model["provider"] = "azure"
                if "kind" not in config:
                    config["kind"] = "key"

                # azure_endpoint → endpoint
                if "azure_endpoint" in config:
                    _deprecation(
                        "model.configuration.azure_endpoint",
                        "model.connection.endpoint",
                    )
                    config["endpoint"] = config.pop("azure_endpoint")

                # azure_deployment → model.id
                if "azure_deployment" in config:
                    _deprecation("model.configuration.azure_deployment", "model.id")
                    model["id"] = config.pop("azure_deployment")

                # api_key → apiKey
                if "api_key" in config:
                    _deprecation("model.configuration.api_key", "model.connection.apiKey")
                    config["apiKey"] = config.pop("api_key")

            elif conn_type == "openai":
                _deprecation("model.configuration.type: openai", "model.provider: openai")
                model["provider"] = "openai"
                if "kind" not in config:
                    config["kind"] = "key"

                if "name" in config:
                    _deprecation("model.configuration.name", "model.id")
                    model["id"] = config.pop("name")

                if "api_key" in config:
                    _deprecation("model.configuration.api_key", "model.connection.apiKey")
                    config["apiKey"] = config.pop("api_key")

            else:
                # Unknown type — try to preserve as connection
                if conn_type:
                    config["kind"] = conn_type

            model["connection"] = config

    # model.parameters → model.options
    if "parameters" in model and "options" not in model:
        params = model.pop("parameters")
        _deprecation("model.parameters", "model.options")

        if isinstance(params, dict):
            # Hoist tools out to top level
            if "tools" in params:
                _deprecation("model.parameters.tools", "tools (top-level)")
                data.setdefault("tools", params.pop("tools"))

            # Rename snake_case → camelCase
            _rename_key(params, "max_tokens", "maxOutputTokens", "model.parameters.max_tokens")
            _rename_key(params, "top_p", "topP", "model.parameters.top_p")
            _rename_key(
                params,
                "frequency_penalty",
                "frequencyPenalty",
                "model.parameters.frequency_penalty",
            )
            _rename_key(
                params,
                "presence_penalty",
                "presencePenalty",
                "model.parameters.presence_penalty",
            )
            _rename_key(params, "stop", "stopSequences", "model.parameters.stop")

            model["options"] = params

    # --- inputs → inputSchema.properties ---
    if "inputs" in data and "inputSchema" not in data:
        _deprecation("inputs", "inputSchema")
        raw_inputs = data.pop("inputs")
        if isinstance(raw_inputs, dict):
            properties: list[dict[str, Any]] = []
            for name, spec in raw_inputs.items():
                if isinstance(spec, dict):
                    prop: dict[str, Any] = {"name": name}
                    # type → kind
                    if "type" in spec:
                        _deprecation(f"inputs.{name}.type", f"inputSchema.properties.{name}.kind")
                        prop["kind"] = spec.pop("type")
                    else:
                        prop["kind"] = "string"
                    # sample → default
                    if "sample" in spec:
                        _deprecation(
                            f"inputs.{name}.sample",
                            f"inputSchema.properties.{name}.default",
                        )
                        prop["default"] = spec.pop("sample")
                    # copy remaining fields
                    for k, v in spec.items():
                        if k not in prop:
                            prop[k] = v
                    properties.append(prop)
                else:
                    # Simple scalar: firstName: Jane
                    properties.append({"name": name, "kind": "string", "default": spec})
            data["inputSchema"] = {"properties": properties}

    # --- outputs → outputSchema ---
    if "outputs" in data and "outputSchema" not in data:
        _deprecation("outputs", "outputSchema")
        data["outputSchema"] = data.pop("outputs")

    # --- Root metadata fields ---
    metadata = data.get("metadata", {})
    if not isinstance(metadata, dict):
        metadata = {}
    moved_meta = False
    for field in ("authors", "tags", "version"):
        if field in data and field not in metadata:
            _deprecation(f"root '{field}'", f"metadata.{field}")
            metadata[field] = data.pop(field)
            moved_meta = True
    if moved_meta:
        data["metadata"] = metadata

    # --- template shorthand ---
    template = data.get("template")
    if isinstance(template, str):
        _deprecation(
            f'template: "{template}" (string)',
            "template: {{ format: {{ kind: ... }} }}",
        )
        data["template"] = {
            "format": {"kind": template},
            "parser": {"kind": "prompty"},
        }
    elif isinstance(template, dict):
        # template.type → template.format.kind
        if "type" in template and "format" not in template:
            _deprecation("template.type", "template.format.kind")
            template["format"] = {"kind": template.pop("type")}
        # Normalise format/parser from string to dict
        if "format" in template and isinstance(template["format"], str):
            _deprecation(
                f'template.format: "{template["format"]}"',
                "template.format: {{ kind: ... }}",
            )
            template["format"] = {"kind": template["format"]}
        if "parser" in template and isinstance(template["parser"], str):
            _deprecation(
                f'template.parser: "{template["parser"]}"',
                "template.parser: {{ kind: ... }}",
            )
            template["parser"] = {"kind": template["parser"]}

    # --- sample (root) ---
    if "sample" in data:
        _deprecation("sample (root)", "inputSchema with value/example fields")
        data.pop("sample")

    data["model"] = model
    return data


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _rename_key(d: dict, old: str, new: str, path: str) -> None:
    if old in d and new not in d:
        _deprecation(path, f"model.options.{new}")
        d[new] = d.pop(old)


def _deprecation(old: str, new: str) -> None:
    warnings.warn(
        f"Prompty: '{old}' is deprecated, use '{new}' instead.",
        DeprecationWarning,
        stacklevel=4,
    )
