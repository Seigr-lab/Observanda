import {lstat,readdir,readlink,realpath,cp} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import reviewed from './native-runtime-inputs.json' with {type:'json'};

const receipts=new WeakMap(),inside=(root,file)=>file===root||file.startsWith(root+path.sep);
export async function runtimeFileDigest(file){const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');}

// Every entry participates, including libraries, configuration, empty directories
// and internal links. A version string or a digest of only the main executable
// cannot authenticate the code that a native loader may subsequently execute.
export async function runtimeTree(directory){
 const root=path.resolve(directory),stat=await lstat(root);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Unsafe native runtime root.');
 const base=await realpath(root),entries=[];
 async function walk(relative){
  for(const name of (await readdir(path.join(root,relative))).sort()){
   if(!name||name==='.'||name==='..'||/[\\:\0]/.test(name))throw Error('Unsafe native runtime entry.');
   const location=path.posix.join(relative,name),file=path.join(root,location),info=await lstat(file);
   if(info.isSymbolicLink()){
    const target=await readlink(file);
    if(path.isAbsolute(target)||/[\\:\0]/.test(target)||!inside(base,await realpath(file))||!(await lstat(await realpath(file))).isFile())throw Error('Unsafe native runtime link.');
    entries.push({path:location,target});
   }else if(info.isDirectory()){entries.push({path:location,directory:true});await walk(location);}
   else if(info.isFile())entries.push({path:location,bytes:info.size,sha256:await runtimeFileDigest(file)});
   else throw Error('Unsupported native runtime entry.');
  }
 }
 await walk('');entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return {root,entries,sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
}

function receipt(tree){const value=Object.freeze({});receipts.set(value,tree);return value;}

// Only builders which have already authenticated an upstream archive/source or
// applied a trusted relocation may seal their output. This is not input trust:
// callers accepting an external directory must use admitReviewedRuntime or
// compare it with a freshly extracted, checksum-pinned upstream archive.
export async function sealPreparedRuntime(directory){return receipt(await runtimeTree(directory));}
export async function assertRuntimeAdmission(directory,admission){
 const expected=receipts.get(admission);
 if(!expected||expected.root!==path.resolve(directory))throw Error('Native runtime requires pre-execution admission.');
 if((await runtimeTree(directory)).sha256!==expected.sha256)throw Error('Native runtime changed after admission.');
 return expected;
}
export function admittedFileDigest(admission,relative){
 const value=receipts.get(admission)?.entries.find(entry=>entry.path===relative)?.sha256;
 if(!value)throw Error('Native runtime executable was not admitted.');return value;
}
export async function admitReviewedRuntime(directory,kind,{platform=process.platform,arch=process.arch}={}){
 // Each catalogue entry needs kind/platform/arch, an independently reviewed
 // source URL and sourceSha256, and the complete extracted treeSha256. Empty
 // targets intentionally fail closed; there is no "trust this folder" option.
 const candidates=reviewed.inputs.filter(input=>input.kind===kind&&input.platform===platform&&input.arch===arch);
 if(!candidates.length)throw Error('No reviewed '+kind+' runtime is pinned for '+platform+'-'+arch+'. Review and pin its complete tree and upstream provenance before packaging.');
 const tree=await runtimeTree(directory);
 if(!candidates.some(input=>/^https:\/\//.test(input.source)&&/^[a-f0-9]{64}$/.test(input.sourceSha256)&&input.treeSha256===tree.sha256))throw Error('Native runtime input does not match a reviewed release.');
 return receipt(tree);
}
export async function admitMatchingRuntime(directory,reference,admission){
 const expected=await assertRuntimeAdmission(reference,admission),tree=await runtimeTree(directory);
 if(tree.sha256!==expected.sha256)throw Error('Native runtime input does not match the pinned upstream archive.');
 return receipt(tree);
}
export async function copyAdmittedRuntime(source,destination,admission){
 const expected=await assertRuntimeAdmission(source,admission);
 try{await lstat(destination);throw Error('Native runtime destination already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await cp(source,destination,{recursive:true,verbatimSymlinks:true,errorOnExist:true,force:false});
 const copied=await runtimeTree(destination);
 if(copied.sha256!==expected.sha256)throw Error('Native runtime changed while copying.');
 return receipt(copied);
}
