# Contributing to Prompty Documentation

Guidelines for contributing to the Prompty docs site (`web/`).

## Writing Documentation

- All code examples **must** have Python / TypeScript / C# tabs, in that order.
- Use Starlight components for all interactive and structural elements:
  ```jsx
  import { Tabs, TabItem, Aside, CardGrid, LinkCard } from '@astrojs/starlight/components';
  ```
- Tab labels must be exactly: `<TabItem label="Python">`, `<TabItem label="TypeScript">`, `<TabItem label="C#">`.
- Use `.mdx` extension for all documentation files.

## Tested Examples Pattern

Code examples should be testable. Place source and tests in the `docs-examples/` directory:

```
web/docs-examples/
├── python/
│   ├── examples/       # Python code examples
│   └── tests/          # pytest tests for examples
├── typescript/
│   ├── examples/       # TypeScript code examples
│   └── tests/          # vitest tests for examples
└── csharp/
    ├── examples/       # C# code examples
    └── tests/          # xUnit tests for examples
```

Import into MDX via `?raw` and render with the `Code` component:

```jsx
import code from '../../../docs-examples/python/examples/load_prompt.py?raw';
import { Code } from 'astro:components';

<Code code={code} lang="python" />
```

## Correct API Names

Use these names consistently in all documentation:

| Language   | Load                    | Invoke                      | Prepare                    | Run                    | Turn (Agent)                 |
|------------|-------------------------|-----------------------------|----------------------------|------------------------|------------------------------|
| Python     | `load()`                | `invoke()`                  | `prepare()`                | `run()`                | `turn()`                     |
| TypeScript | `load()`                | `invoke()`                  | `prepare()`                | `run()`                | `turn()`                     |
| C#         | `Pipeline.LoadAsync()`  | `Pipeline.InvokeAsync()`    | `Pipeline.PrepareAsync()`  | `Pipeline.RunAsync()`  | `Pipeline.TurnAsync()`       |

## Schema Property Names

Use the v2 AgentSchema names — not the legacy v1 names:

| Correct             | Incorrect (legacy)       |
|---------------------|--------------------------|
| `inputs`            | `inputSchema`            |
| `outputs`           | `outputSchema`           |
| `maxOutputTokens`   | `max_tokens`             |
| `connection`        | `configuration`          |
| `kind`              | `type` (for properties)  |

## Running Docs Locally

```bash
cd web
npm install
npm run dev
```

The site will be available at `http://localhost:4321` with hot-reload.

To test a production build:

```bash
cd web
npm run build && npm run start
```

## Running Docs Tests

```bash
# Python
cd web/docs-examples/python && pip install -e ".[dev]" && pytest

# TypeScript
cd web/docs-examples/typescript && npm install && npm test

# C#
cd web/docs-examples/csharp && dotnet test
```

## Running the Spec Linter

```bash
python web/docs-examples/lint_docs.py
```

## Pull Request Checklist

- [ ] All code examples have Python / TypeScript / C# tabs
- [ ] API names match the table above
- [ ] Schema property names use v2 AgentSchema conventions
- [ ] `npm run build` succeeds without errors
- [ ] New pages have correct `sidebar.order` in frontmatter
