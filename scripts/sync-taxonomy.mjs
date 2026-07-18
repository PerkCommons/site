import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(
  root,
  ".data/taxonomy/opportunity-taxonomy.json",
);
const destination = resolve(
  root,
  "src/generated/opportunity-taxonomy.ts",
);
const sourceText = await readFile(source, "utf8").catch(() => {
  throw new Error(
    "Canonical taxonomy is unavailable. Run npm run fetch:data first.",
  );
});
const expected = `const taxonomy = ${JSON.stringify(JSON.parse(sourceText), null, 2)} as const;\n\nexport default taxonomy;\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(destination, "utf8").catch(() => "");
  if (current !== expected) {
    throw new Error(
      "Generated taxonomy is out of date. Run npm run sync:taxonomy.",
    );
  }
} else {
  await writeFile(destination, expected, "utf8");
  console.log("Synchronized the opportunity taxonomy from PerkCommons/data.");
}
