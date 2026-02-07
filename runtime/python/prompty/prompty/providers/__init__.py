"""Provider implementations for LLM APIs.

Each provider lives in its own subpackage (e.g. ``openai/``, ``azure/``)
and exposes an executor and processor class registered via entry points.

To add a new provider, create a new subpackage here with:
- ``executor.py`` — implements ``execute()`` / ``execute_async()``
- ``processor.py`` — implements ``process()`` / ``process_async()``

Then register the classes in ``pyproject.toml`` under
``[project.entry-points."prompty.executors"]`` and
``[project.entry-points."prompty.processors"]``.
"""
