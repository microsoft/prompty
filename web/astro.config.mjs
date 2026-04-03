// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import devtoolsJson from "vite-plugin-devtools-json";
import starlightAutoSidebar from "starlight-auto-sidebar";
import starlightLinksValidator from "starlight-links-validator";
import mermaid from "astro-mermaid";

export default defineConfig({
  site: "https://prompty.ai/",
  trailingSlash: "always",
  integrations: [
    mermaid({
      theme: 'forest',
      autoTheme: true
    }),
    starlight({
      title: "Prompty",
      components: {
        SiteTitle: "./src/overrides/SiteTitle.astro",
      },
      customCss: ["./src/styles/custom.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/microsoft/prompty",
        },
      ],
      plugins: [starlightAutoSidebar(), starlightLinksValidator({
        errorOnRelativeLinks: false,
        exclude: ({ slug, link }) => {
          // Exclude all links originating from legacy pages
          if (slug && slug.startsWith("legacy")) return true;
          // Exclude localhost dev server links in docs
          if (link && link.startsWith("http://localhost")) return true;
          return false;
        },
      })],
      sidebar: [
        {
          label: "Welcome",
          slug: "welcome",
        },
        {
          label: "Getting Started",
          autogenerate: { directory: "getting-started" },
        },
        {
          label: "Core Concepts",
          autogenerate: { directory: "core-concepts" },
        },
        {
          label: "Schema Reference",
          autogenerate: { directory: "reference" },
        },
        {
          label: "Implementation",
          autogenerate: { directory: "implementation" },
        },
        {
          label: "How-To Guides",
          autogenerate: { directory: "how-to" },
        },
        {
          label: "API Reference",
          autogenerate: { directory: "api-reference" },
        },
        {
          label: "Migration",
          slug: "migration",
        },
        {
          label: "Legacy (v1)",
          collapsed: true,
          autogenerate: { directory: "legacy" },
          badge: { text: "v1", variant: "note" },
        },
        {
          label: "Contributing",
          autogenerate: { directory: "contributing" },
        },
      ],
    }),
  ],
});
