// @ts-check
import { defineConfig, passthroughImageService } from "astro/config";
import starlight from "@astrojs/starlight";
import devtoolsJson from "vite-plugin-devtools-json";
import starlightAutoSidebar from "starlight-auto-sidebar";

export default defineConfig({
  site: "https://prompty.ai/",
  trailingSlash: "always",
  vite: {
    plugins: [devtoolsJson()],
  },
  image: {
    service: passthroughImageService(),
  },
  integrations: [
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
      plugins: [starlightAutoSidebar()],
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
