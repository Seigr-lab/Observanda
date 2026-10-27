import {readFile,lstat,readdir,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {PDF_VALIDATOR_VERSION,PDF_VALIDATOR_SHA256,pdfJavaArtifacts} from './pdf-validation-dependencies.js';
const fail=()=>Object.assign(new Error('PDF_ARCHIVAL_UNAVAILABLE'),{code:'PDF_ARCHIVAL_UNAVAILABLE'});
const relative=value=>typeof value==='string'&&value.length<512&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[\\:\0]/.test(part));
export async function pdfValidationFiles(directory,{signal}={}){
 const rows=[];let total=0;
 async function visit(prefix){for(const entry of await readdir(path.join(directory,prefix),{withFileTypes:true})){signal?.throwIfAborted();const name=path.posix.join(prefix,entry.name);if(name==='runtime.json')continue;if(!relative(name))throw fail();const file=path.join(directory,name),stat=await lstat(file);if(stat.isSymbolicLink())throw fail();if(stat.isDirectory()){await visit(name);continue;}if(!stat.isFile()||rows.length>=4096||(total+=stat.size)>512*1024*1024)throw fail();const hash=createHash('sha256');for await(const chunk of createReadStream(file)){signal?.throwIfAborted();hash.update(chunk);}rows.push({path:name,bytes:stat.size,sha256:hash.digest('hex')});}}
 await visit('');return rows.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function resolvePdfValidationRuntime({directory,signal}={}){
 signal?.throwIfAborted();try{
  const selected=directory??(process.resourcesPath?path.join(process.resourcesPath,'pdf-validation'):fileURLToPath(new URL('../.local/pdf-validation/',import.meta.url))),base=await realpath(selected),manifestFile=path.join(base,'runtime.json');if((await lstat(manifestFile)).size>1024*1024)throw fail();const manifest=JSON.parse(await readFile(manifestFile,'utf8')),artifact=pdfJavaArtifacts[process.platform+'-'+process.arch];
  if(!artifact||manifest.version!==1||manifest.platform!==process.platform||manifest.arch!==process.arch||manifest.validatorVersion!==PDF_VALIDATOR_VERSION||manifest.validatorSha256!==PDF_VALIDATOR_SHA256||manifest.javaVersion!==artifact.version||manifest.javaArchiveSha256!==artifact.sha256||!relative(manifest.java)||manifest.jar!=='verapdf-cli.jar'||!Array.isArray(manifest.files))throw fail();
  if(JSON.stringify(await pdfValidationFiles(base,{signal}))!==JSON.stringify(manifest.files))throw fail();
  const jar=manifest.files.find(row=>row.path===manifest.jar),java=manifest.files.find(row=>row.path===manifest.java);if(jar?.sha256!==PDF_VALIDATOR_SHA256||!java||manifest.java!=='java/bin/java'+(process.platform==='win32'?'.exe':''))throw fail();
  return Object.freeze({directory:base,java:path.join(base,manifest.java),jar:path.join(base,manifest.jar),validatorSha256:PDF_VALIDATOR_SHA256});
 }catch{signal?.throwIfAborted();throw fail();}
}
export async function pdfArchivalAvailable({runtime,directory,signal}={}){try{await resolvePdfValidationRuntime({directory:directory??runtime?.directory,signal});return true;}catch{signal?.throwIfAborted();return false;}}
