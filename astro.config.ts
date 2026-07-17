import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://perkcommons.com",
  output: "static",
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes("/moderate") && !page.includes("/moderator-login"),
    }),
  ],
  vite: { plugins: [tailwindcss()] },
  build: { format: "directory" },
});
