import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

const site =
  process.env.PUBLIC_SITE_URL?.trim() ?? "https://perkcommons.com";

export default defineConfig({
  site,
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
