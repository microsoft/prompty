/**
 * Python scaffolding emitter — static/structural files.
 *
 * Replaces the Nunjucks templates:
 *   - `context.py.njk`  → emitPythonContext()
 *   - `init.py.njk`     → emitPythonInit()
 *
 * Also provides:
 *   - emitPythonGroupInit()  → per-group __init__.py (re-exports group types)
 *
 * These emit files whose content depends only on the type graph
 * shape (not on the Declaration IR used for per-type files).
 */

import { TypeNode } from "../../ir/ast.js";

/**
 * Emit the _context.py file content (LoadContext + SaveContext classes).
 * Replaces context.py.njk template.
 */
export function emitPythonContext(header: string): string {
  const headerLine = header ? `# ${header}\n` : '';
  return `${headerLine}import json
from dataclasses import dataclass
from typing import Any, Callable, Optional

import yaml


@dataclass
class LoadContext:
    """
    Context for customizing the loading process of agent definitions.

    Provides hooks for pre-processing input data before parsing and
    post-processing output data after instantiation.
    """

    pre_process: Optional[Callable[[dict[str, Any]], dict[str, Any]]] = None
    """Optional callback to transform input data before parsing."""

    post_process: Optional[Callable[[Any], Any]] = None
    """Optional callback to transform the result after instantiation."""

    def process_input(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Apply pre-processing to input data if a pre_process callback is set.

        Args:
            data: The raw input dictionary to process.

        Returns:
            The processed dictionary, or the original if no callback is set.
        """
        if self.pre_process is not None:
            return self.pre_process(data)
        return data

    def process_output(self, result: Any) -> Any:
        """
        Apply post-processing to the result if a post_process callback is set.

        Args:
            result: The instantiated object to process.

        Returns:
            The processed result, or the original if no callback is set.
        """
        if self.post_process is not None:
            return self.post_process(result)
        return result


@dataclass
class SaveContext:
    """
    Context for customizing the serialization process of agent definitions.

    Provides hooks for pre-processing the object before serialization and
    post-processing the dictionary after serialization.
    """

    pre_save: Optional[Callable[[Any], Any]] = None
    """Optional callback to transform the object before serialization."""

    post_save: Optional[Callable[[dict[str, Any]], dict[str, Any]]] = None
    """Optional callback to transform the dictionary after serialization."""

    collection_format: str = "object"
    """Output format for collections: 'object' (name as key) or 'array' (list of dicts)."""

    use_shorthand: bool = True
    """Use shorthand scalar representation when possible (e.g., {"myTool": "function"})."""

    def process_object(self, obj: Any) -> Any:
        """
        Apply pre-processing to the object if a pre_save callback is set.

        Args:
            obj: The object to process before serialization.

        Returns:
            The processed object, or the original if no callback is set.
        """
        if self.pre_save is not None:
            return self.pre_save(obj)
        return obj

    def process_dict(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Apply post-processing to the dictionary if a post_save callback is set.

        Args:
            data: The serialized dictionary to process.

        Returns:
            The processed dictionary, or the original if no callback is set.
        """
        if self.post_save is not None:
            return self.post_save(data)
        return data

    def to_yaml(self, data: dict[str, Any]) -> str:
        """
        Convert the dictionary to a YAML string.

        Args:
            data: The dictionary to convert.

        Returns:
            The YAML string representation.
        """
        return yaml.dump(data, default_flow_style=False, sort_keys=False)

    def to_json(self, data: dict[str, Any], indent: int = 2) -> str:
        """
        Convert the dictionary to a JSON string.

        Args:
            data: The dictionary to convert.
            indent: Number of spaces for indentation.

        Returns:
            The JSON string representation.
        """
        return json.dumps(data, indent=indent)
`;
}

/**
 * Emit the __init__.py file content.
 * Replaces init.py.njk template.
 *
 * When types are organised into group subfolders, the root __init__.py imports
 * from each group sub-package (e.g. `from .connection import Connection`).
 */
export function emitPythonInit(baseTypes: TypeNode[], types: TypeNode[]): string {
  const lines: string[] = [];

  lines.push('##########################################');
  lines.push('# WARNING: This is an auto-generated file.');
  lines.push('# DO NOT EDIT THIS FILE DIRECTLY');
  lines.push('# ANY EDITS WILL BE LOST');
  lines.push('##########################################');
  lines.push('from ._context import LoadContext, SaveContext');

  // Group root types by their semantic group folder.
  // Types without a group are emitted directly in the root model folder.
  const groupMap = new Map<string, TypeNode[]>();
  for (const type of baseTypes) {
    const g = type.group || "";
    if (!groupMap.has(g)) groupMap.set(g, []);
    groupMap.get(g)!.push(type);
  }

  // Sort groups for deterministic output
  const sortedGroups = Array.from(groupMap.keys()).sort();

  for (const group of sortedGroups) {
    const groupTypes = groupMap.get(group)!;
    if (!group) {
      // Root-level types — import directly from the file
      for (const type of groupTypes) {
        if (type.childTypes.length > 0) {
          const names = [type.typeName.name, ...type.childTypes.map(c => c.typeName.name)];
          if (!type.isProtocol && type.methods.length > 0) {
            names.push(`${type.typeName.name}Helpers`);
          }
          lines.push('');
          lines.push(`from ._${type.typeName.name} import (`);
          for (const name of names) {
            lines.push(`  ${name},`);
          }
          lines.push(')');
        } else {
          const names = [type.typeName.name];
          if (!type.isProtocol && type.methods.length > 0) {
            names.push(`${type.typeName.name}Helpers`);
          }
          lines.push('');
          if (names.length === 1) {
            lines.push(`from ._${type.typeName.name} import ${type.typeName.name}`);
          } else {
            lines.push(`from ._${type.typeName.name} import (`);
            for (const name of names) {
              lines.push(`  ${name},`);
            }
            lines.push(')');
          }
        }
      }
    } else {
      // Group subfolder — import from the group's __init__.py (which re-exports all group types)
      lines.push('');
      lines.push(`from .${group} import (`);
      for (const type of groupTypes) {
        const allNames = [type.typeName.name, ...type.childTypes.map(c => c.typeName.name)];
        if (!type.isProtocol && type.methods.length > 0) {
          allNames.push(`${type.typeName.name}Helpers`);
        }
        for (const name of allNames) {
          lines.push(`    ${name},`);
        }
      }
      lines.push(')');
    }
  }

  lines.push('');
  lines.push('__all__ = [');
  lines.push('    "LoadContext",');
  lines.push('    "SaveContext",');
  for (const type of types) {
    lines.push(`    "${type.typeName.name}",`);
    if (!type.isProtocol && type.methods.length > 0) {
      lines.push(`    "${type.typeName.name}Helpers",`);
    }
  }
  lines.push(']');

  return lines.join('\n') + '\n';
}

/**
 * Emit a group-level __init__.py that re-exports all types defined in that group.
 * This file lives at `model/{group}/__init__.py` and lets the root `__init__.py`
 * import from the group package with `from .{group} import TypeA, TypeB, ...`.
 */
export function emitPythonGroupInit(group: string, groupNodes: TypeNode[]): string {
  const lines: string[] = [];

  lines.push('##########################################');
  lines.push('# WARNING: This is an auto-generated file.');
  lines.push('# DO NOT EDIT THIS FILE DIRECTLY');
  lines.push('# ANY EDITS WILL BE LOST');
  lines.push('##########################################');

  for (const type of groupNodes) {
    const names = [type.typeName.name, ...type.childTypes.map(c => c.typeName.name)];
    if (!type.isProtocol && type.methods.length > 0) {
      names.push(`${type.typeName.name}Helpers`);
    }
    if (names.length === 1) {
      lines.push(`from ._${type.typeName.name} import ${names[0]}`);
    } else {
      lines.push(`from ._${type.typeName.name} import (`);
      for (const name of names) {
        lines.push(`    ${name},`);
      }
      lines.push(')');
    }
  }

  lines.push('');
  lines.push('__all__ = [');
  for (const type of groupNodes) {
    const names = [type.typeName.name, ...type.childTypes.map(c => c.typeName.name)];
    if (!type.isProtocol && type.methods.length > 0) {
      names.push(`${type.typeName.name}Helpers`);
    }
    for (const name of names) {
      lines.push(`    "${name}",`);
    }
  }
  lines.push(']');

  return lines.join('\n') + '\n';
}
