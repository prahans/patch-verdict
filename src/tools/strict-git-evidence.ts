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
  // Git's working-tree diff trusts its index flags and clean filters. Instead,
  // compare every tracked file's raw bytes to HEAD and build a separate index
  // from those exact bytes. Neither the repository's index nor its filters can
  // decide which bytes become proof or the eventual published patch.
  const script = String.raw`
const {execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const expected=${JSON.stringify(expectedCommit)},generated=${JSON.stringify(generatedPath ?? null)},capture=${capture};
const root=process.cwd(),gitDirectory=path.join(root,'.git');
if(fs.realpathSync(root)!==root||!fs.lstatSync(gitDirectory).isDirectory()||fs.lstatSync(gitDirectory).isSymbolicLink())throw Error('Unsupported Git directory');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_ATTR_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_OPTIONAL_LOCKS:'0',LC_ALL:'C'});
const git=(args,options={})=>new TextDecoder('utf-8',{fatal:true}).decode(execFileSync('git',[
 '--git-dir='+gitDirectory,'--work-tree='+root,'-c','core.hooksPath=/dev/null','-c','core.quotePath=false',
 '-c','core.fsmonitor=false','-c','core.attributesFile=/dev/null','-c','core.excludesFile=/dev/null',
 '-c','core.autocrlf=false','-c','core.fileMode=true','-c','core.ignoreStat=false',...args
],{env,maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe'],...options}));
const records=value=>value.split('\0').filter(Boolean);
const config=records(git(['config','--local','--no-includes','--null','--list']));
for(const record of config){
 const key=record.split('\n',1)[0].toLowerCase();
 if(/^(?:include(?:if\..*)?\.path|filter\.|diff\.|extensions\.|core\.(?:worktree|fsmonitor|ignorestat|sparsecheckout|sparsecheckoutcone|attributesfile|excludesfile)$)/.test(key))throw Error('Unsupported Git configuration: '+key);
}
for(const name of ['attributes','exclude']){
 const file=path.join(gitDirectory,'info',name);
 if(fs.existsSync(file)){
  const info=fs.lstatSync(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw Error('Unsupported Git info file');
  if(fs.readFileSync(file,'utf8').split(/\r?\n/).some(line=>line.trim()&&!line.trimStart().startsWith('#')))throw Error('Unsupported Git info overrides');
 }
}
const head=git(['rev-parse','HEAD']).trim();if(head!==expected)throw Error('Repository HEAD changed');
const safe=file=>typeof file==='string'&&file.length>0&&file.length<=500&&!/[\\\x00-\x1f\x7f:]/.test(file)&&!path.isAbsolute(file)&&file.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/^\.git$/i.test(part));
const entries=new Map();
for(const record of records(git(['ls-tree','-r','-z','--full-tree',head]))){
 const match=/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/s.exec(record);
 if(!match||!safe(match[3]))throw Error('Unsupported tracked file path or mode');
 entries.set(match[3],{mode:match[1],hash:match[2]});
 if(entries.size>10000)throw Error('Tracked file count exceeds integrity limit');
}
if(generated&&(!safe(generated)||entries.has(generated)))throw Error('Registered regression must be a new safe path');
for(const flag of records(git(['ls-files','-v','-z']))){
 if(!flag.startsWith('H '))throw Error('Git index contains hidden or unsupported entries');
}
const index=new Map();
for(const record of records(git(['ls-files','--stage','-z']))){
 const match=/^(100644|100755) ([0-9a-f]{40}) 0\t(.+)$/s.exec(record);
 if(!match)throw Error('Unsupported Git index entry');
 const base=entries.get(match[3]);
 if(!base||base.mode!==match[1]||base.hash!==match[2])throw Error('Git index changed from the selected base');
 index.set(match[3],true);
}
if(index.size!==entries.size)throw Error('Git index population changed');
const untracked=records(git(['ls-files','--others','--exclude-standard','-z']));
if(untracked.some(file=>file!==generated))throw Error('Unexpected untracked repository files');
const paths=[...entries.keys(),...(generated?[generated]:[])];
if(paths.length){
 const attrs=records(git(['check-attr','-z','--stdin','filter','working-tree-encoding','ident'],{input:paths.join('\0')+'\0'}));
 for(let i=0;i<attrs.length;i+=3)if(!['unspecified','unset'].includes(attrs[i+2]))throw Error('Unsupported Git attribute: '+attrs[i+1]);
}
let totalBytes=0;
const changes=new Map();
for(const file of paths){
 let current=root;
 for(const part of file.split('/')){
  current=path.join(current,part);
  if(fs.lstatSync(current).isSymbolicLink())throw Error('Repository symlink changed');
 }
 const descriptor=fs.openSync(current,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{
  const info=fs.fstatSync(descriptor),base=entries.get(file);
  if(!info.isFile()||info.nlink!==1||info.size>16*1024*1024)throw Error('Unsupported tracked file or size');
  const mode=process.platform==='win32'?(base?.mode||'100644'):((info.mode&0o111)?'100755':'100644');
  if((base&&mode!==base.mode)||(!base&&mode!=='100644'))throw Error('Repository file mode changed');
  totalBytes+=info.size;if(totalBytes>128*1024*1024)throw Error('Repository bytes exceed integrity limit');
  const bytes=fs.readFileSync(descriptor);
  if(bytes.length!==info.size)throw Error('Repository file changed while reading');
  const hash=crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  if(!base||hash!==base.hash){
   if(bytes.length>(file===generated?65536:2*1024*1024)||bytes.includes(0)||!require('node:buffer').isUtf8(bytes))throw Error('Unsupported changed file bytes');
   changes.set(file,{mode,hash,bytes});
  }
 }finally{fs.closeSync(descriptor);}
}
const changedFiles=[...changes.keys()].sort();
if(!capture&&changedFiles.some(file=>file!==generated))throw Error('Production or verification files changed before repair');
let diff='';
if(capture&&changedFiles.length){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'patchverdict-evidence-'));
 try{
  const temporaryEnv={...env,GIT_INDEX_FILE:path.join(directory,'index')};
  git(['read-tree',head],{env:temporaryEnv});
  for(const [file,change]of changes){
   const hash=git(['hash-object','-w','--no-filters','--stdin'],{input:change.bytes}).trim();
   if(hash!==change.hash)throw Error('Raw Git blob hash differs');
   git(['update-index','--add','--cacheinfo',change.mode,hash,file],{env:temporaryEnv});
  }
  diff=git(['diff','--cached',head,'--no-ext-diff','--no-textconv','--no-color','--no-renames','--full-index','--text','--src-prefix=a/','--dst-prefix=b/'],{env:temporaryEnv});
  const patchFiles=records(git(['diff','--cached',head,'--name-only','--no-renames','-z'],{env:temporaryEnv})).sort();
  if(JSON.stringify(patchFiles)!==JSON.stringify(changedFiles))throw Error('Patch does not account for every changed file');
 }finally{
  if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('patchverdict-evidence-'))throw Error('Unsafe evidence cleanup');
  fs.rmSync(directory,{recursive:true,force:true});
 }
}
if(Buffer.byteLength(diff)>2*1024*1024||diff.includes('GIT binary patch')||diff.includes('Binary files '))throw Error('Unsupported patch bytes');
process.stdout.write(JSON.stringify({baseCommit:head,changedFiles,diff,changed:diff.length>0}));
`;
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
