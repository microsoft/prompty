// @ts-check
import { defineConfig, passthroughImageService } from "astro/config";
import starlight from "@astrojs/starlight";
import devtoolsJson from "vite-plugin-devtools-json";
import starlightAutoSidebar from "starlight-auto-sidebar";
import starlightLinksValidator from "starlight-links-validator";
import mermaid from "astro-mermaid";

export default defineConfig({
  site: "https://prompty.ai/",
  trailingSlash: "always",
  image: {
    service: passthroughImageService(),
  },
  integrations: [
    mermaid({
      theme: 'forest',
      autoTheme: true
    }),
    starlight({
      title: "Prompty",
      logo: {
        src: "./src/assets/prompty_p.svg",
        replacesTitle: true,
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
          label: "Contributing",
          autogenerate: { directory: "contributing" },
        },
      ],
    }),
  ],
});
