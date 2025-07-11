# Prompty Documentation

[![Built with Starlight](https://astro.badg.es/v2/built-with-starlight/tiny.svg)](https://starlight.astro.build)
[![GitHub](https://img.shields.io/badge/GitHub-microsoft%2Fprompty-blue?logo=github)](https://github.com/microsoft/prompty)

This repository contains the official documentation website for [Prompty](https://github.com/microsoft/prompty), a Microsoft project that provides an asset class and format for LLM prompts designed to enhance observability, understandability, and portability for developers.

## About Prompty

Prompty is designed to accelerate the developer inner loop of prompt engineering and prompt source management in a cross-language and cross-platform implementation. It helps developers build, test, and deploy generative AI applications more efficiently.

## Documentation Overview

This documentation covers:

- **Getting Started**: Core concepts, setup instructions, and your first Prompty
- **Tutorials**: Step-by-step guides for using Prompty with popular frameworks like LangChain and Semantic Kernel
- **Specification**: Technical specifications and format details
- **Guides**: In-depth guides for advanced usage and best practices
- **Contributing**: How to contribute to the Prompty project

Visit the live documentation at **[prompty.ai](https://prompty.ai/)**

## 🚀 Project Structure

This is an Astro + Starlight documentation site with the following structure:

```
.
├── public/                    # Static assets (images, favicons)
├── src/
│   ├── assets/               # Shared assets (logos, images)
│   ├── components/           # Astro components
│   ├── content/
│   │   └── docs/            # Documentation content (.md/.mdx files)
│   │       ├── getting-started/
│   │       ├── tutorials/
│   │       ├── specification/
│   │       ├── guides/
│   │       └── contributing/
│   └── styles/              # Custom CSS styles
├── astro.config.mjs         # Astro configuration
├── package.json
└── tsconfig.json
```

Starlight looks for `.md` or `.mdx` files in the `src/content/docs/` directory. Each file is exposed as a route based on its file name and directory structure.

## 🧞 Development Commands

All commands are run from the root of the project:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`     |
| `npm run build`           | Build your production site to `./dist/`         |
| `npm run preview`         | Preview your build locally, before deploying    |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check`|

## 📝 Contributing to Documentation

We welcome contributions to improve the Prompty documentation! Here's how you can help:

### Content Guidelines

1. **File Organization**: Add new documentation files to the appropriate directory in `src/content/docs/`
2. **Frontmatter**: Include proper frontmatter with title, description, authors, and date
3. **Markdown Format**: Use `.mdx` format for enhanced capabilities with React components
4. **Images**: Place images in the appropriate subdirectory alongside your content

### Example Frontmatter

```yaml
---
title: Your Page Title
description: Brief description of the page content
authors:
  - yourusername
date: 2025-01-10
tags:
  - relevant
  - tags
sidebar:
  order: 1  # Optional: control sidebar ordering
---
```

### Local Development

1. Clone this repository
2. Install dependencies: `npm install`
3. Start the dev server: `npm run dev`
4. Open your browser to `http://localhost:4321`
5. Make your changes and see them live-reload

### Sidebar Navigation

The sidebar is automatically generated using the `starlight-auto-sidebar` plugin based on the directory structure in `src/content/docs/`. You can also manually configure sections in `astro.config.mjs`.

## 🔗 Related Links

- **Main Prompty Repository**: [microsoft/prompty](https://github.com/microsoft/prompty)
- **Live Documentation**: [prompty.ai](https://prompty.ai/)
- **Astro Documentation**: [docs.astro.build](https://docs.astro.build)
- **Starlight Documentation**: [starlight.astro.build](https://starlight.astro.build/)

## 📄 License

This project follows the same license as the main Prompty project. Please refer to the [main repository](https://github.com/microsoft/prompty) for license details.