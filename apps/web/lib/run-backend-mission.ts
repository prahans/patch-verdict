import "server-only";

import { spawn, type ChildProcess } from "node:child_process";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { loadProofBundle } from "./load-proof-bundle";
import { parseMissionInput, type MissionInput } from "./mission-input";
import { resolveRepositoryRoot } from "./repository-root";

export const MISSION_TIMEOUT_MS = 270_000;
const MAX_LOG_CHARACTERS = 64 * 1024;
const MAX_LINE_CHARACTERS = 4096;

export class BackendMissionError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "BackendMissionError";
    this.status = status;
  }
}

type Execution = {
  missionIds: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

function terminateProcessTree(child: ChildProcess) {
  if (!child.pid) return;
  // The tsx CLI may start its own Node child. Terminate the entire tree.
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", () => child.kill("SIGKILL"));
    killer.once("close", (code) => {
      if (code !== 0) child.kill("SIGKILL");
    });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

function execute(
  repositoryRoot: string,
  input: MissionInput,
  timeoutMs: number,
): Promise<Execution> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let pendingLine = "";
    let lineOverflow = false;
    const missionIds = new Set<string>();
    let timedOut = false;
    let settled = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;

    // Every user field is a separate argument; reproductionCommand is data for
    // the existing backend to execute in its sandbox, never a host command.
    const child = spawn(
      process.execPath,
      [
        path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        path.join(repositoryRoot, "src", "real-mission-demo.ts"),
        input.repositoryUrl,
        input.issue,
        input.reproductionCommand,
        input.requiredOutput,
      ],
      {
        cwd: repositoryRoot,
        env: process.env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const parseLine = () => {
      if (!lineOverflow) {
        const match = /^Mission ID: ([A-Za-z0-9_-]+)\s*$/.exec(pendingLine);
        if (match) {
          missionIds.add(match[1]);
          // Keep a bounded set of recent candidates; logs can contain arbitrary text.
          if (missionIds.size > 32) missionIds.delete(missionIds.values().next().value!);
        }
      }
      pendingLine = "";
      lineOverflow = false;
    };
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceTimer);
      parseLine();
      resolve({ missionIds: [...missionIds], stdout, stderr, exitCode, timedOut });
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-MAX_LOG_CHARACTERS);
      // Keep parsing lines even when the bounded log tail rolls over. This also
      // handles a Mission ID split across stream chunks without unbounded lines.
      const fragments = chunk.split("\n");
      for (let index = 0; index < fragments.length; index++) {
        if (!lineOverflow) {
          if (pendingLine.length + fragments[index].length > MAX_LINE_CHARACTERS) {
            lineOverflow = true;
            pendingLine = "";
          } else {
            pendingLine += fragments[index];
          }
        }
        if (index < fragments.length - 1) parseLine();
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_LOG_CHARACTERS);
    });
    child.once("error", () => finish(null));
    child.once("close", finish);
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
      // Never wait indefinitely for a process that ignores termination or keeps
      // inherited pipes open. Unix gets a final group SIGKILL after a short grace.
      forceTimer = setTimeout(() => {
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        } else {
          child.kill("SIGKILL");
        }
        finish(null);
      }, 2000);
    }, timeoutMs);
  });
}

export async function runBackendMission(
  values: MissionInput,
  options: { timeoutMs?: number } = {},
): Promise<{ missionId: string }> {
  const input = parseMissionInput(values);
  let repositoryRoot: string;
  try {
    repositoryRoot = await resolveRepositoryRoot();
    await access(path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"));
  } catch {
    throw new BackendMissionError("The mission runner is unavailable. Install the backend dependencies and restart the server.", 503);
  }

  const startedAt = Date.now();
  let execution: Execution;
  try {
    execution = await execute(repositoryRoot, input, options.timeoutMs ?? MISSION_TIMEOUT_MS);
  } catch {
    throw new BackendMissionError("The mission runner could not start. Check the server configuration and try again.");
  }
  if (execution.timedOut) {
    throw new BackendMissionError("The verification mission exceeded its time limit and was stopped. Try a smaller reproduction command or repository.", 504);
  }
  if (!execution.missionIds.length) {
    throw new BackendMissionError("The backend stopped before producing a mission ID and proof bundle. Check the server credentials and try again.");
  }

  // User-controlled test output can contain apparent Mission ID lines. Only a
  // newly written bundle for these exact inputs is authoritative.
  for (const missionId of execution.missionIds.reverse()) {
    try {
      const bundle = await loadProofBundle(missionId);
      const proofFile = await stat(path.join(repositoryRoot, "output", missionId, "proof.json"));
      const [issueTitle, ...issueDescription] = input.issue.split(/\r?\n/);
      const sourceUrl = bundle.details.source?.repositoryUrl.replace(/\.git\/?$/, "").replace(/\/$/, "");
      if (
        proofFile.mtimeMs < startedAt - 1000 ||
        sourceUrl !== input.repositoryUrl.replace(/\.git$/, "") ||
        bundle.details.title !== issueTitle.trim() ||
        bundle.details.description !== issueDescription.join("\n").trim() ||
        bundle.details.reproduction.command !== input.reproductionCommand
      ) continue;
      // FAILED is a valid saved result, regardless of CLI exit status.
      return { missionId };
    } catch {
      // Ignore invalid IDs printed by repository output; examine other candidates.
    }
  }
  throw new BackendMissionError("The backend did not produce a readable proof bundle for this mission. Please try the mission again.");
}
