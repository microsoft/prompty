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
        exclude: ["http://localhost:4321"]
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
          label: "Tutorials",
          autogenerate: { directory: "tutorials" },
        },
        {
          label: "Specification",
          autogenerate: { directory: "specification" },
        },
        {
          label: "Guides",
          autogenerate: { directory: "guides" },
        },
        {
          label: "v2 (Alpha)",
          autogenerate: { directory: "v2" },
          badge: { text: "Alpha", variant: "caution" },
        },
        {
          label: "Contributing",
          autogenerate: { directory: "contributing" },
        },
      ],
    }),
  ],
});
