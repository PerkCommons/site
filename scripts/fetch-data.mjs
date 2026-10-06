import { access, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { isExactCommitRef, resolveDataSource } from "./data-source.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(repositoryRoot, ".data");
const explicitPath = process.env.PERKCOMMONS_DATA_REPOSITORY_PATH?.trim();
const siblingPath = resolve(repositoryRoot, "../data");
for (const localPath of [explicitPath, siblingPath].filter(Boolean)) {
  try {
    await access(resolve(localPath, "opportunities"));
    console.log(`Using isolated local data checkout at ${localPath}.`);
    process.exit(0);
  } catch {
    if (explicitPath === localPath) {
      throw new Error(`PERKCOMMONS_DATA_REPOSITORY_PATH does not contain opportunities/: ${localPath}`);
    }
  }
}

const { repository: dataRepository, ref: dataRef } =
  resolveDataSource(process.env);

await rm(destination, { recursive: true, force: true });

const runGit = (args, label) =>
  new Promise((resolveCommand, rejectCommand) => {
    const command = spawn("git", args, {
      cwd: repositoryRoot,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: "inherit",
    });

    command.once("error", rejectCommand);
    command.once("close", (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }

      const reason = signal
        ? `signal ${signal}`
        : `exit code ${code ?? "unknown"}`;
      rejectCommand(new Error(`${label} ended with ${reason}`));
    });
  });

try {
  if (isExactCommitRef(dataRef)) {
    await runGit(["init", destination], "git init");
    await runGit(
      ["-C", destination, "remote", "add", "origin", dataRepository],
      "git remote add",
    );
    await runGit(
      ["-C", destination, "fetch", "--depth", "1", "origin", dataRef],
      "git fetch",
    );
    await runGit(
      ["-C", destination, "checkout", "--detach", dataRef],
      "git checkout",
    );
  } else {
    await runGit(
      [
        "clone",
        "--depth",
        "1",
        "--single-branch",
        ...(dataRef ? ["--branch", dataRef] : []),
        dataRepository,
        destination,
      ],
      "git clone",
    );
  }
} catch (error) {
  await rm(destination, { recursive: true, force: true });
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Failed to fetch PerkCommons data from ${dataRepository}: ${reason}`);
  process.exitCode = 1;
}
