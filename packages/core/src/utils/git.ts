import { runCommand } from "./runCommand";
import { logger } from "./logger";

export interface GitStatus {
  isDirty: boolean;
  files: string[];
}

/**
 * Check if there are uncommitted changes to package.json or lockfiles
 */
export async function checkGitDirty(
  rootDir: string,
  patterns: string[] = ["**/package.json", "**/pnpm-lock.yaml", "**/package-lock.json", "**/yarn.lock"]
): Promise<GitStatus> {
  try {
    // Check if we're in a git repo
    const { code: isGitRepo } = await runCommand("git rev-parse --git-dir", {
      cwd: rootDir,
      stdio: "pipe",
      allowFail: true,
    });

    if (isGitRepo !== 0) {
      logger.debug("Not a git repository, skipping dirty check");
      return { isDirty: false, files: [] };
    }

    // Get status for matching patterns
    const { stdout } = await runCommand(
      `git status --porcelain ${patterns.join(" ")}`,
      {
        cwd: rootDir,
        stdio: "pipe",
        allowFail: true,
      }
    );

    const lines = stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim().length > 0);

    // Get all files from git status
    let allFiles = lines.map((line) => {
      // Format: "XY filename" where X and Y are status codes
      return line.slice(3).trim();
    });

    // Filter out files that are ignored by git (using git check-ignore)
    const filteredFiles: string[] = [];
    for (const file of allFiles) {
      const { code } = await runCommand(`git check-ignore "${file}"`, {
        cwd: rootDir,
        stdio: "pipe",
        allowFail: true,
      });
      // If check-ignore returns 0, file is ignored, so skip it
      if (code !== 0) {
        filteredFiles.push(file);
      }
    }

    return {
      isDirty: filteredFiles.length > 0,
      files: filteredFiles,
    };
  } catch (error) {
    logger.warn("Failed to check git status", error);
    // If git check fails, we assume clean to not block operations
    return { isDirty: false, files: [] };
  }
}

