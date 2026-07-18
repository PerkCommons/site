import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(repositoryRoot, ".data");
const dataRepository = "https://github.com/PerkCommons/data.git";

await rm(destination, { recursive: true, force: true });

try {
  await new Promise((resolveClone, rejectClone) => {
    const clone = spawn(
      "git",
      ["clone", "--depth", "1", "--single-branch", dataRepository, destination],
      {
        cwd: repositoryRoot,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        stdio: "inherit",
      },
    );

    clone.once("error", rejectClone);
    clone.once("close", (code, signal) => {
      if (code === 0) {
        resolveClone();
        return;
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      rejectClone(new Error(`git clone ended with ${reason}`));
    });
  });
} catch (error) {
  await rm(destination, { recursive: true, force: true });
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Failed to fetch PerkCommons data from ${dataRepository}: ${reason}`);
  process.exitCode = 1;
}
