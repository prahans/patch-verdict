import type { Sandbox } from "e2b";
import { runSandboxCommand } from "../sandbox/e2b.js";
import type { GitEvidence } from "./git-evidence.js";

function nodeCommand(script: string): string {
  return (
    "node -e 'eval(Buffer.from(\"" +
    Buffer.from(script).toString("base64") +
    '","base64").toString())\''
  );
}
async function inspect(
  sandbox: Sandbox,
  projectRoot: string,
  expectedCommit: string,
  generatedPath?: string,
  capture = false,
) {
  const script = [
    "const {execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');",
    "const expected=" +
      JSON.stringify(expectedCommit) +
      ",generated=" +
      JSON.stringify(generatedPath ?? null) +
      ";",
    "const git=(args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.quotePath=false',...args],{encoding:'utf8',maxBuffer:3*1024*1024});",
    "const head=git(['rev-parse','HEAD']).trim();if(head!==expected)throw Error('Repository HEAD changed');",
    "const untracked=git(['ls-files','--others','--exclude-standard','-z']).split('\\0').filter(Boolean);",
    "if(untracked.some(p=>p!==generated))throw Error('Unexpected untracked repository files');",
    "if(generated){",
    "if(path.isAbsolute(generated)||generated.split('/').some(p=>!p||p==='.'||p==='..'||p==='.git')||generated.includes('\\\\'))throw Error('Unsafe registered regression path');",
    "let part=process.cwd();for(const segment of generated.split('/')){part=path.join(part,segment);if(fs.lstatSync(part).isSymbolicLink())throw Error('Regression symlink');}",
    "if(fs.statSync(generated).size>65536)throw Error('Regression file exceeds byte limit');",
    capture ? "git(['add','--intent-to-add','--',generated]);" : "",
    "}",
    "const changedFiles=git(['diff','HEAD','--name-only','-z']).split('\\0').filter(Boolean);",
    "const raw=git(['diff','HEAD','--raw','--no-abbrev','-z']).split('\\0').filter(Boolean);",
    "for(let i=0;i<raw.length;i+=2){const entry=raw[i].split(' ');if(![':100644',':100755',':000000'].includes(entry[0])||!['100644','100755'].includes(entry[1]))throw Error('Unsupported file mode or deletion');}",
    capture
      ? ""
      : "if(changedFiles.some(p=>p!==generated))throw Error('Production or verification files changed before repair');",
    "const diff=" +
      (capture
        ? "git(['diff','HEAD','--no-ext-diff','--no-textconv','--no-color','--binary'])"
        : "''") +
      ";",
    "if(Buffer.byteLength(diff)>2*1024*1024||diff.includes('GIT binary patch')||diff.includes('Binary files '))throw Error('Unsupported patch bytes');",
    "process.stdout.write(JSON.stringify({baseCommit:head,changedFiles,diff,changed:diff.length>0}));",
  ].join("\n");
  const result = await runSandboxCommand(
    sandbox,
    nodeCommand(script),
    projectRoot,
  );
  if (result.exitCode !== 0)
    throw new Error(
      "Repository integrity check failed: " + result.stderr.slice(-2000),
    );
  return JSON.parse(result.stdout) as GitEvidence;
}
export async function assertUntouchedRepository(
  sandbox: Sandbox,
  projectRoot: string,
  expectedCommit: string,
  generatedPath?: string,
): Promise<void> {
  await inspect(sandbox, projectRoot, expectedCommit, generatedPath);
}
export async function captureStrictGitEvidence(
  sandbox: Sandbox,
  projectRoot: string,
  expectedCommit: string,
  generatedPath?: string,
): Promise<GitEvidence> {
  return inspect(sandbox, projectRoot, expectedCommit, generatedPath, true);
}
export async function frozenFileHash(
  sandbox: Sandbox,
  projectRoot: string,
  testPath: string,
): Promise<string> {
  const script = [
    "const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const file=" +
      JSON.stringify(testPath) +
      ";",
    "if(path.isAbsolute(file)||file.includes('\\\\')||file.split('/').some(p=>!p||p==='.'||p==='..'||p==='.git'))throw Error('Unsafe frozen path');",
    "let p=process.cwd();for(const segment of file.split('/')){p=path.join(p,segment);if(fs.lstatSync(p).isSymbolicLink())throw Error('Frozen test is a symlink');}",
    "if(!fs.statSync(p).isFile()||fs.statSync(p).size>512*1024)throw Error('Invalid frozen test file');",
    "process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));",
  ].join("\n");
  const result = await runSandboxCommand(
    sandbox,
    nodeCommand(script),
    projectRoot,
  );
  if (result.exitCode !== 0 || !/^[0-9a-f]{64}$/.test(result.stdout))
    throw new Error("Frozen reproduction file cannot be verified.");
  return result.stdout;
}
