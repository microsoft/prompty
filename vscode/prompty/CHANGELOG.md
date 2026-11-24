# Changelog

## 2.2.0

First stable release of the Prompty 2 extension.

### Security

- Prompts run in-process through the Prompty TypeScript runtime. The extension never
  opens a terminal, sends text to a terminal, or spawns a process to run a prompt. This
  removes the v1 behavior that built a `prompty --source <file>` shell command from the
  file name (MSRC 150092). A unit test guards the source tree, and the release build
  checks the shipped VSIX.

### Changed

- Uses the GA Prompty TypeScript runtime: `@prompty/core`, `@prompty/openai`,
  `@prompty/foundry`, and `@prompty/anthropic` 2.1.0.
- Supports Prompty 2 `.prompty` files (`model`, `inputs`, `outputs`, `tools`,
  `template`). The runtime still loads legacy v1 files with deprecation warnings.
- Updated to `vscode-languageclient` / `vscode-languageserver` 10.
- Smaller VSIX that ships only the bundled extension, language server, and trace viewer.

### Removed

- Dropped the direct `@azure/ai-projects` dependency. Foundry support comes from
  `@prompty/foundry`.
