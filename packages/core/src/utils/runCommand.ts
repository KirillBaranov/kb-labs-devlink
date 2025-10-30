import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import { logger } from "./logger";

export type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** inherit — стримим в консоль; pipe — собираем буферы */
  stdio?: "inherit" | "pipe";
  /** по умолчанию true, чтобы работать с строкой-командой */
  shell?: boolean;
  /** не падать при ненулевом коде */
  allowFail?: boolean;
  /** убить процесс по таймауту (мс) */
  timeoutMs?: number;
};

/**
 * Запускает shell-команду. По умолчанию стримит вывод (stdio=inherit).
 * Бросает ошибку при ненулевом коде, если allowFail !== true.
 */
export function runCommand(
  cmd: string,
  opts: RunCommandOptions = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const {
    cwd,
    env,
    stdio = "inherit",
    shell = true,
    allowFail = false,
    timeoutMs,
  } = opts;

  logger.debug("runCommand start", { cmd, cwd });

  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = {
      cwd,
      env: { ...process.env, ...env },
      shell,
      stdio,
    };

    const child = spawn(cmd, [], spawnOpts);

    let stdout = "";
    let stderr = "";

    if (stdio === "pipe") {
      child.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
      child.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
    }

    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        logger.warn("runCommand timeout, killing process", { cmd, cwd, timeoutMs });
        child.kill("SIGKILL");
      }, timeoutMs);
    }

    child.on("error", (err) => {
      if (timer) {clearTimeout(timer);}
      logger.error("runCommand error", { cmd, cwd, err });
      reject(err);
    });

    child.on("close", (code) => {
      if (timer) {clearTimeout(timer);}
      logger.debug("runCommand done", { cmd, cwd, code, stdoutLen: stdout.length, stderrLen: stderr.length });

      if (code === 0 || allowFail) {
        resolve({ code: code ?? 0, stdout, stderr });
      } else {
        const error = new Error(`Command failed (${code}): ${cmd}\n${stderr}`);
        (error as any).code = code;
        (error as any).stdout = stdout;
        (error as any).stderr = stderr;
        reject(error);
      }
    });
  });
}