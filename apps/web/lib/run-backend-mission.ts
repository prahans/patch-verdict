import { spawn } from "node:child_process";
import path from "node:path";

export type BackendMissionInput = {
  repositoryUrl: string;
  issue: string;
  reproductionCommand: string;
  requiredOutput?: string;
};

export type BackendMissionRun = {
  missionId: string;
  stdout: string;
  stderr: string;
};

function validateInput(input: BackendMissionInput) {
  let repositoryUrl: URL;

  try {
    repositoryUrl = new URL(input.repositoryUrl);
  } catch {
    throw new Error("Repository URL must be a valid URL.");
  }

  if (
    repositoryUrl.protocol !== "https:" ||
    repositoryUrl.hostname !== "github.com"
  ) {
    throw new Error("Repository URL must be an HTTPS GitHub URL.");
  }

  if (!input.issue.trim()) {
    throw new Error("Issue description is required.");
  }

  if (!input.reproductionCommand.trim()) {
    throw new Error("Reproduction command is required.");
  }
}

function tail(value: string, max = 5000) {
  return value.length <= max ? value : value.slice(-max);
}

export async function runBackendMission(
  input: BackendMissionInput,
): Promise<BackendMissionRun> {
  validateInput(input);

  const repositoryRoot = path.resolve(process.cwd(), "../..");
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  const args = [
    "real:demo",
    input.repositoryUrl.trim(),
    input.issue.trim(),
    input.reproductionCommand.trim(),
  ];

  if (input.requiredOutput?.trim()) {
    args.push(input.requiredOutput.trim());
  }

  return await new Promise<BackendMissionRun>((resolve, reject) => {
    const child = spawn(pnpmCommand, args, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          "PatchVerdict mission timed out after 3 minutes. Check the backend terminal and try again.",
        ),
      );
    }, 180_000);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Could not start the PatchVerdict backend: ${error.message}`,
        ),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        reject(
          new Error(
            [
              `PatchVerdict backend exited with code ${code ?? "unknown"}.`,
              tail(stderr || stdout),
            ]
              .filter(Boolean)
              .join("\n\n"),
          ),
        );
        return;
      }

      const match = stdout.match(/^Mission ID:\s*([A-Za-z0-9_-]+)\s*$/m);

      if (!match?.[1]) {
        reject(
          new Error(
            [
              "Backend completed but did not print a Mission ID.",
              tail(stdout),
            ].join("\n\n"),
          ),
        );
        return;
      }

      resolve({
        missionId: match[1],
        stdout,
        stderr,
      });
    });
  });
}
