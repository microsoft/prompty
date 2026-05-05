# Prompty Trace Viewer

React/Vite webview used by the VS Code extension to inspect `.tracy` trace
files produced by Prompty runs.

The viewer is packaged into the extension by the parent `vscode/prompty` build:

```bash
cd vscode/prompty
npm run build:trace
```

For local development inside this package:

```bash
npm install
npm run dev
npm run build
```
