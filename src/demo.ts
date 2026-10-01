import "dotenv/config";
import { createSandbox } from "./sandbox/e2b.js";

const sandbox = await createSandbox();

try {
  const result = await sandbox.commands.run("echo hello");
  console.log(result.stdout);
} finally {
  await sandbox.kill();
}
