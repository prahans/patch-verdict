import "server-only";

import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

// Both the CLI bridge and the proof reader must use the same checkout, whether
// Next is launched at the repository root or from apps/web.
export async function resolveRepositoryRoot(start = process.cwd()): Promise<string> {
  let candidate = await realpath(start);
  while (true) {
    try {
      const manifest = JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8"));
      if (
        manifest.name === "patch-verdict" &&
        (await stat(path.join(candidate, "src", "real-mission-demo.ts"))).isFile()
      ) {
        return candidate;
      }
    } catch {
      // A parent without the fixed project markers is not the backend root.
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error("The PatchVerdict checkout could not be located.");
    }
    candidate = parent;
  }
}
