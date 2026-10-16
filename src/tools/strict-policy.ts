import type { Sandbox } from "e2b";
import type { ToolResult } from "../agent/types.js";
import { runSandboxCommand } from "../sandbox/e2b.js";

export type StrictToolResult = ToolResult<Record<string, unknown>>;
export type StrictToolExecutor = (sandbox: Sandbox, name: string, input: unknown) => Promise<StrictToolResult>;

export const MAX_GENERATED_TEST_ATTEMPTS = 2;
export const MAX_GENERATED_TEST_BYTES = 32_768;

export function safeRepositoryPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 500 &&
    !/[\\\x00-\x1f\x7f:]/.test(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== ".." &&
      !/^\.git(?:$|\.)/i.test(part) && !/[. ]$/.test(part)) &&
    !/(^|\/)(node_modules|\.env(?:\.[^/]*)?)(\/|$)/i.test(value);
}

export function isSupportedRegressionPath(value: unknown): value is string {
  return safeRepositoryPath(value) && /\.(?:test|spec)\.(?:js|jsx|ts|tsx)$/.test(value);
}

export function isProductionRepairPath(value: unknown): value is string {
  if (!safeRepositoryPath(value) || !/\.(?:[cm]?[jt]s|jsx|tsx)$/.test(value)) return false;
  // Deliberately narrow. Configuration, helpers and lifecycle files may alter
  // test discovery or execution even when their names do not contain "test".
  return !/(^|\/)(?:\.[^/]+|__[^/]+__|tests?|specs?|fixtures?|mocks?|scripts?|config|configs|coverage|dist|build|e2e|cypress|playwright|setup|ci)(\/|$)/i.test(value) &&
    !/(?:^|[/._-])(?:test|tests|spec|specs|mock|fixture|config|setup|teardown|vitest|jest|babel|webpack|rollup|vite|eslint|prettier|tsconfig|gulpfile|gruntfile)(?:[._-]|$)/i.test(value) &&
    !/(^|\/)setupTests\./i.test(value) && !/\.d\.[cm]?ts$/.test(value);
}

function inputObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function failure(error: string): StrictToolResult { return { ok: false, error }; }

// This program is owned by PatchVerdict. Model input is JSON data encoded as
// base64, never shell text or executable code. Repository modules are not loaded.
const FILE_PROGRAM = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const payload = JSON.parse(Buffer.from(process.argv[1], 'base64').toString('utf8'));
const root = path.resolve(payload.root);
const safe = value => typeof value === 'string' && value.length > 0 && value.length <= 500 &&
 !/[\\\x00-\x1f\x7f:]/.test(value) && value.split('/').every(p => p && p !== '.' && p !== '..' && !/^\.git(?:$|\.)/i.test(p) && !/[. ]$/.test(p)) &&
 !/(^|\/)(node_modules|\.env(?:\.[^/]*)?)(\/|$)/i.test(value);
const checkRoot = () => {
 if (!path.isAbsolute(payload.root) || fs.realpathSync(root) !== root || !fs.lstatSync(root).isDirectory()) throw Error('Invalid repository root.');
};
const resolveFile = (relative, missing = false) => {
 if (!safe(relative)) throw Error('Unsupported repository path.');
 let current = root;
 const segments = relative.split('/');
 for (let index = 0; index < segments.length; index++) {
  current = path.join(current, segments[index]);
  let info;
  try { info = fs.lstatSync(current); } catch (error) {
   if (error.code === 'ENOENT' && missing && index === segments.length - 1) return current;
   throw Error('Repository file or parent directory does not exist.');
  }
  if (info.isSymbolicLink()) throw Error('Symbolic links are not supported.');
  if (index < segments.length - 1 && !info.isDirectory()) throw Error('Invalid parent directory.');
  if (index === segments.length - 1 && (!info.isFile() || info.nlink !== 1)) throw Error('Only regular, singly linked files are supported.');
 }
 return current;
};
const read = relative => {
 const filename = resolveFile(relative);
 const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
 try {
  const info = fs.fstatSync(descriptor);
  if (!info.isFile() || info.nlink !== 1 || info.size > 131072) throw Error('Repository file exceeds the read limit.');
  const buffer = fs.readFileSync(descriptor);
  if (buffer.length > 131072 || buffer.includes(0) || !require('node:buffer').isUtf8(buffer)) throw Error('Only bounded UTF-8 text is supported.');
  return buffer.toString('utf8');
 } finally { fs.closeSync(descriptor); }
};
const inventory = depth => {
 const files = [];
 let visited = 0;
 const walk = (relative, level) => {
  if (level > depth || files.length >= 400 || visited > 2000) return;
  const directory = path.join(root, relative);
  for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
   if (++visited > 2000 || files.length >= 400) break;
   const file = relative ? relative + '/' + item.name : item.name;
   if (!safe(file) || item.isSymbolicLink()) continue;
   if (item.isDirectory()) walk(file, level + 1);
   else if (item.isFile()) files.push(file);
  }
 };
 walk('', 1);
 return files;
};
try {
 checkRoot();
 let data;
 if (payload.op === 'read_file') data = { path: payload.path, content: read(payload.path) };
 else if (payload.op === 'list_files') data = { files: inventory(payload.depth) };
 else if (payload.op === 'search_code') {
  const matches = [];
  let bytes = 0;
  for (const file of inventory(8)) {
   if (matches.length >= 40 || bytes >= 1048576) break;
   if (!/\.(?:[cm]?[jt]s|jsx|tsx|json|md|ya?ml)$/.test(file)) continue;
   let contents; try { contents = read(file); } catch { continue; }
   bytes += Buffer.byteLength(contents);
   for (const [index,line] of contents.split(/\r?\n/).entries()) {
    if (line.includes(payload.query)) matches.push({ line: (file + ':' + (index+1) + ':' + line).slice(0,1000) });
    if (matches.length >= 40) break;
   }
  }
  data = { query: payload.query, matches };
 } else if (payload.op === 'write_regression_test') {
  const filename = resolveFile(payload.path, payload.first);
  const exists = fs.existsSync(filename);
  if (payload.first && exists) throw Error('Regression file must be new.');
  if (!payload.first && (!exists || crypto.createHash('sha256').update(read(payload.path)).digest('hex') !== payload.previousSha256)) throw Error('Generated regression changed outside its writer.');
  const descriptor = fs.openSync(filename, fs.constants.O_WRONLY | (payload.first ? fs.constants.O_CREAT | fs.constants.O_EXCL : 0) | (fs.constants.O_NOFOLLOW || 0), 0o644);
  try {
   const info = fs.fstatSync(descriptor);
   if (!info.isFile() || info.nlink !== 1) throw Error('Only a regular new regression file may be written.');
   fs.writeFileSync(descriptor, payload.content, 'utf8');
   fs.ftruncateSync(descriptor, Buffer.byteLength(payload.content));
  } finally { fs.closeSync(descriptor); }
  data = { path: payload.path, sha256: crypto.createHash('sha256').update(read(payload.path)).digest('hex') };
 } else if (payload.op === 'apply_patch') {
  const filename = resolveFile(payload.path);
  const before = read(payload.path);
  const ending = before.includes('\r\n') ? '\r\n' : '\n';
  const oldText = payload.oldText.replace(/\r?\n/g, ending);
  const newText = payload.newText.replace(/\r?\n/g, ending);
  const occurrences = before.split(oldText).length - 1;
  if (occurrences !== 1) throw Error('oldText must match exactly one existing region. Read the file and use exact current bytes.');
  const after = before.replace(oldText, () => newText);
  if (Buffer.byteLength(after) > 131072) throw Error('Candidate file exceeds the repair size limit.');
  if (before !== after) {
   const descriptor = fs.openSync(filename, fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0));
   try {
    const info = fs.fstatSync(descriptor);
    if (!info.isFile() || info.nlink !== 1) throw Error('Only regular production files may be modified.');
    fs.writeFileSync(descriptor, after, 'utf8');
    fs.ftruncateSync(descriptor, Buffer.byteLength(after));
   } finally { fs.closeSync(descriptor); }
  }
  data = { path: payload.path, changed: before !== after };
 } else throw Error('Tool is not permitted.');
 process.stdout.write(JSON.stringify({ ok: true, data }));
} catch (error) {
 process.stdout.write(JSON.stringify({ ok: false, error: String(error.message).slice(0,300) }));
}
`;

async function operation(sandbox: Sandbox, root: string, data: Record<string, unknown>): Promise<StrictToolResult> {
  const source = Buffer.from(FILE_PROGRAM).toString("base64");
  const payload = Buffer.from(JSON.stringify({ ...data, root })).toString("base64");
  const command = `node -e 'eval(Buffer.from("${source}","base64").toString("utf8"))' '${payload}'`;
  try {
    const result = await runSandboxCommand(sandbox, command, root);
    if (result.exitCode !== 0 || result.stdout.length > 200_000) return failure("Repository tool could not complete within its bounds.");
    const parsed = JSON.parse(result.stdout) as StrictToolResult;
    if (!parsed || typeof parsed !== "object" || typeof parsed.ok !== "boolean") return failure("Repository tool returned invalid evidence.");
    return parsed;
  } catch { return failure("Repository tool failed safely."); }
}

export function createStrictRepositoryTools(projectRoot: string): StrictToolExecutor {
  return async (sandbox, name, input) => {
    const data = inputObject(input);
    if (!data) return failure("Tool input must be an object.");
    if (name === "read_file") {
      if (!safeRepositoryPath(data.path)) return failure("Unsupported repository path.");
      return operation(sandbox, projectRoot, { op: name, path: data.path });
    }
    if (name === "list_files") {
      const depth = data.depth ?? 5;
      if (!Number.isInteger(depth) || Number(depth) < 1 || Number(depth) > 8) return failure("Depth must be between 1 and 8.");
      return operation(sandbox, projectRoot, { op: name, depth });
    }
    if (name === "search_code") {
      if (typeof data.query !== "string" || data.query.length < 1 || data.query.length > 100 || /[\x00-\x1f]/.test(data.query)) return failure("Search requires bounded plain text.");
      return operation(sandbox, projectRoot, { op: name, query: data.query });
    }
    return failure("This phase permits only bounded repository reads.");
  };
}

export function createRegressionWriter(projectRoot: string) {
  let generatedPath: string | undefined;
  let attempts = 0;
  let sha256: string | undefined;
  let frozen = false;
  return {
    get path() { return generatedPath; },
    get attempts() { return attempts; },
    freeze() { frozen = true; },
    async write(sandbox: Sandbox, input: unknown): Promise<StrictToolResult> {
      if (frozen) return failure("The regression is frozen and cannot be modified.");
      if (attempts >= MAX_GENERATED_TEST_ATTEMPTS) return failure("Generated regression revision budget exhausted.");
      const data = inputObject(input);
      if (!data || !isSupportedRegressionPath(data.path)) return failure("Use one safe new .test/.spec JS/TS regression file.");
      if (generatedPath && data.path !== generatedPath) return failure("Only the original generated regression path may be revised.");
      if (typeof data.content !== "string" || !data.content.trim() || Buffer.byteLength(data.content) > MAX_GENERATED_TEST_BYTES || data.content.includes("\0") || /[\uD800-\uDFFF]/u.test(data.content)) return failure("Generated regression must be bounded valid UTF-8 text.");
      if (/\b(?:it|test|describe)\s*\.\s*(?:only|skip|todo)|\b(?:xit|xtest|xdescribe)\s*\(/.test(data.content)) return failure("Focused, skipped, and pending regressions are not accepted.");
      // Reserve the path and budget before executing, including uncertain writes.
      generatedPath ??= data.path;
      attempts++;
      const result = await operation(sandbox, projectRoot, {
        op: "write_regression_test", path: data.path, content: data.content,
        first: sha256 === undefined, previousSha256: sha256,
      });
      if (result.ok && typeof result.data.sha256 === "string") sha256 = result.data.sha256;
      return result;
    },
  };
}

export type StrictRepairPolicy = ReturnType<typeof createStrictRepairPolicy>;

export function createStrictRepairPolicy(options: {
  projectRoot: string;
  allowedProductionFiles: string[];
  frozenTestPath?: string;
  protectedPaths?: string[];
}) {
  const protectedPaths = new Set([...(options.protectedPaths ?? []), ...(options.frozenTestPath ? [options.frozenTestPath] : [])]);
  const allowed = new Set(options.allowedProductionFiles.filter((file) => isProductionRepairPath(file) && !protectedPaths.has(file)));
  const reads = createStrictRepositoryTools(options.projectRoot);
  const changed = new Set<string>();
  let rejectedScope = false;
  const execute: StrictToolExecutor = async (sandbox, name, input) => {
    if (name !== "apply_patch") return reads(sandbox, name, input);
    const data = inputObject(input);
    if (!data || typeof data.path !== "string" || !allowed.has(data.path) || (changed.size > 0 && !changed.has(data.path))) {
      rejectedScope = true;
      return failure("UNSUPPORTED_REPAIR_SCOPE: only one grounded production JS/TS file may change; tests and verification infrastructure are protected.");
    }
    if (typeof data.oldText !== "string" || !data.oldText || typeof data.newText !== "string" || Buffer.byteLength(data.oldText) > 50_000 || Buffer.byteLength(data.newText) > 50_000 || data.oldText.includes("\0") || data.newText.includes("\0")) return failure("Repair requires a bounded exact text replacement.");
    const result = await operation(sandbox, options.projectRoot, { op: "apply_patch", path: data.path, oldText: data.oldText, newText: data.newText });
    if (result.ok && result.data.changed === true) changed.add(data.path);
    return result;
  };
  return {
    execute,
    get changedFiles() { return [...changed]; },
    get allowedProductionFiles() { return [...allowed]; },
    get rejectedScope() { return rejectedScope; },
  };
}
