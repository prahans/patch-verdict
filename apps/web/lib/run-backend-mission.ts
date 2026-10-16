import "server-only";

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import {
  parseBackendMissionInput,
  type MissionInput,
  type ParsedMissionInput,
} from "./mission-input";
import {
  parseBackendEventLine,
  type MissionLiveEvent,
} from "./mission-live-types";
import {
  completeMissionLiveStatus,
  createMissionLiveStatus,
  failMissionLiveStatus,
  recordMissionLiveEvent,
} from "./mission-live-status";
import { resolveRepositoryRoot } from "./repository-root";
import { cleanupMissionOutput } from "./mission-retention";

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

function terminateProcessTree(child: ChildProcess) {
  if (!child.pid) return;
  // tsx starts its own Node process. Kill the whole tree without a host shell.
  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      },
    );
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
  input: ParsedMissionInput,
  missionId: string,
  timeoutMs: number,
) {
  return new Promise<{ timedOut: boolean; persistenceFailed: boolean }>(
    (resolve) => {
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
          env: {
            ...process.env,
            // An explicit empty value also stops dotenv from restoring the
            // server's write token inside the verification child process.
            PATCHVERDICT_GITHUB_TOKEN: "",
            PATCHVERDICT_MISSION_ID: missionId,
            PATCHVERDICT_GITHUB_ISSUE: input.githubIssue ? JSON.stringify(input.githubIssue) : "",
          },
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let stdout = "";
      let stderr = "";
      let line = "";
      let overflow = false;
      let timedOut = false;
      let settled = false;
      let persistenceFailed = false;
      let updates = Promise.resolve();
      let forceTimer: ReturnType<typeof setTimeout> | undefined;

      const record = (event: Omit<MissionLiveEvent, "timestamp">) => {
        // Serialize events in stdout order, including across separate chunks.
        updates = updates
          .then(async () => {
            if (persistenceFailed) return;
            await recordMissionLiveEvent(missionId, event);
          })
          .catch(() => {
            persistenceFailed = true;
            terminateProcessTree(child);
          });
      };

      const parseLine = () => {
        if (!overflow) {
          const text = line.replace(/\r$/, "");
          const event = parseBackendEventLine(text, missionId);
          if (event) record(event);
        }
        line = "";
        overflow = false;
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!timedOut) clearTimeout(forceTimer);
        parseLine();
        void updates.then(() => resolve({ timedOut, persistenceFailed }));
      };

      child.once("spawn", () =>
        record({ state: "PREPARING", message: "Backend process started." }),
      );
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        // Logs are bounded in memory and never persisted or sent to the browser.
        stdout = (stdout + chunk).slice(-MAX_LOG_CHARACTERS);
        const fragments = chunk.split("\n");
        for (let index = 0; index < fragments.length; index++) {
          if (!overflow) {
            if (line.length + fragments[index].length > MAX_LINE_CHARACTERS) {
              overflow = true;
              line = "";
            } else line += fragments[index];
          }
          if (index < fragments.length - 1) parseLine();
        }
      });
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-MAX_LOG_CHARACTERS);
      });
      child.once("error", finish);
      child.once("close", finish);

      const timeout = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child);
        forceTimer = setTimeout(() => {
          if (process.platform !== "win32" && child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          } else child.kill("SIGKILL");
          finish();
        }, 2000);
      }, timeoutMs);
    },
  );
}

export async function runBackendMission(
  values: MissionInput,
  options: { timeoutMs?: number } = {},
): Promise<{ missionId: string; completion: Promise<void> }> {
  const input = parseBackendMissionInput(values);
  const timeoutMs = options.timeoutMs ?? MISSION_TIMEOUT_MS;
  let repositoryRoot: string;
  try {
    repositoryRoot = await resolveRepositoryRoot();
    await access(
      path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    );
  } catch {
    throw new BackendMissionError(
      "The mission runner is unavailable. Install the backend dependencies and restart the server.",
      503,
    );
  }

  const missionId = `web-${randomUUID()}`;
  try {
    await createMissionLiveStatus(missionId, input, timeoutMs);
  } catch {
    throw new BackendMissionError(
      "The mission could not be saved. Check the server's output directory and try again.",
      503,
    );
  }

  // execute() starts the real child immediately. Only startup is awaited by POST;
  // Next's after callback retains the completion promise after the 202 response.
  const completion = execute(repositoryRoot, input, missionId, timeoutMs)
    .then(async (result) => {
      if (result.timedOut) {
        await failMissionLiveStatus(
          missionId,
          "The verification mission exceeded its time limit and was stopped. Try a smaller reproduction command or repository.",
        );
        return;
      }
      if (await completeMissionLiveStatus(missionId)) return; // A FAILED verdict is still a valid proof result.
      await failMissionLiveStatus(
        missionId,
        result.persistenceFailed
          ? "Mission progress could not be saved. Please start a new mission."
          : "The backend stopped before producing a readable proof bundle. Check the server configuration and try again.",
      );
    })
    .catch(async () => {
      await failMissionLiveStatus(
        missionId,
        "The mission runner could not complete. Check the server configuration and try again.",
      ).catch(() => {
        // Disk failures cannot be repaired here. Existing on-disk deadlines ensure
        // a restarted server cannot report a permanently running mission.
        console.error(
          "PatchVerdict could not persist the mission's terminal status.",
        );
      });
    })
    .finally(async () => {
      try {
        await cleanupMissionOutput();
      } catch {
        /*
         * Retention cleanup must never turn an otherwise
         * successful verification mission into a failure.
         */
        console.error("PatchVerdict could not clean old mission output.");
      }
    });
  return { missionId, completion };
}
