import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://delinya.org",
  integrations: [
    starlight({
      title: "Delinya Docs",
      logo: { src: "./src/assets/logo.svg" },
      favicon: "/favicon.svg",
      customCss: [
        "@fontsource-variable/inter",
        "@fontsource/ibm-plex-mono/400.css",
        "./src/styles/starlight.css",
      ],
      components: {
        ThemeProvider: "./src/components/starlight/ThemeProvider.astro",
        ThemeSelect: "./src/components/starlight/ThemeSelect.astro",
      },
      sidebar: [
        { label: "Introduction", link: "/docs/" },
        { label: "Getting started", link: "/docs/getting-started/" },
        { label: "Guide", autogenerate: { directory: "docs/guide" } },
        { label: "How-to", autogenerate: { directory: "docs/howto" } },
        { label: "Reference", autogenerate: { directory: "docs/reference" } },
      ],
      disable404Route: true,
    }),
    mdx(),
    sitemap(),
    icon(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
