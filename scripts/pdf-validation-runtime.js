import {mkdir,mkdtemp,readFile,writeFile,copyFile,cp,rm,readdir,lstat,rename} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {PDF_VALIDATOR_VERSION,PDF_VALIDATOR_SHA256,pdfJavaSources,pdfValidatorArtifact,pdfValidatorLicense,pdfJavaArtifacts} from '../src/pdf-validation-dependencies.js';
import {pdfValidatorNotices} from './pdf-validation-notices.js';
import {pdfValidationFiles} from '../src/pdf-archival-runtime.js';
const execute=promisify(execFile);
const safe=name=>name.length<512&&!name.startsWith('/')&&!/[\\:\0]/.test(name)&&name.replace(/\/$/,'').split('/').every(part=>part&&part!=='.'&&part!=='..');
async function hash(file){const value=createHash('sha256');for await(const chunk of createReadStream(file))value.update(chunk);return value.digest('hex');}
async function checkedDownload(download,artifact){const file=await download(artifact.name,artifact.url,artifact.sha256);if(await hash(file)!==artifact.sha256||artifact.bytes!==undefined&&(await lstat(file)).size!==artifact.bytes)throw Error('PDF validation runtime checksum mismatch.');return file;}
async function names(tar,archive){const {stdout}=await execute(tar,['-tf',archive],{windowsHide:true,timeout:30000,maxBuffer:4*1024*1024}),rows=stdout.trim().split(/\r?\n/);if(rows.length>10000||rows.some(name=>!safe(name)))throw Error('Invalid PDF validation runtime archive.');return rows;}
async function coordinates(directory){const rows=[];async function visit(base){for(const entry of await readdir(base,{withFileTypes:true})){const file=path.join(base,entry.name);if(entry.isDirectory())await visit(file);else if(entry.name==='pom.properties'){const values=Object.fromEntries((await readFile(file,'utf8')).split(/\r?\n/).filter(line=>/^(groupId|artifactId|version)=/.test(line)).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));if(!Object.values(values).every(value=>/^[a-zA-Z0-9_.-]+$/.test(value))||!values.groupId||!values.artifactId||!values.version)throw Error('Invalid validator source metadata.');const prefix='https://repo.maven.apache.org/maven2/'+values.groupId.replaceAll('.','/')+'/'+values.artifactId+'/'+values.version+'/'+values.artifactId+'-'+values.version;rows.push({...values,pom:prefix+'.pom',source:prefix+'-sources.jar'});}}}await visit(directory);return rows.sort((a,b)=>(a.groupId+':'+a.artifactId).localeCompare(b.groupId+':'+b.artifactId,'en'));}
export const pdfValidationRuntimeFiles=(platform=process.platform)=>[
 'pdf-validation/runtime.json','pdf-validation/verapdf-cli.jar','pdf-validation/java/bin/java'+(platform==='win32'?'.exe':''),
 'pdf-validation/java/NOTICE','pdf-validation/java/legal/java.base/LICENSE','pdf-validation/licenses/veraPDF-MPL-2.0.txt','pdf-validation/SOURCES.json'
];
export async function preparePdfValidationRuntime({out,cache,download,run,platform=process.platform,arch=process.arch}){
 const artifact=pdfJavaArtifacts[platform+'-'+arch];if(!artifact||!pdfJavaSources[artifact.version]||typeof download!=='function'||typeof run!=='function')throw Error('Unsupported PDF validation runtime.');
 const destination=path.join(path.resolve(out),'pdf-validation'),scratchParent=path.resolve(cache);await mkdir(scratchParent,{recursive:true});await mkdir(path.dirname(destination),{recursive:true});
 try{await lstat(destination);throw Error('PDF validation runtime destination already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
 const scratch=await mkdtemp(path.join(scratchParent,'pdf-validation-')),payload=path.join(scratch,'payload'),unpack=path.join(scratch,'unpack'),tar=process.platform==='win32'?'tar.exe':'/usr/bin/tar';
 try{
  const archive=await checkedDownload(download,artifact),jar=await checkedDownload(download,pdfValidatorArtifact),license=await checkedDownload(download,pdfValidatorLicense),entries=await names(tar,archive);if(entries.some(name=>!name.startsWith('jdk-'+artifact.version+'-jre/')))throw Error('Unexpected Java runtime archive root.');
  await mkdir(unpack);await mkdir(payload);await run(tar,['-xf',archive,'-C',unpack]);
  const source=path.join(unpack,'jdk-'+artifact.version+'-jre',...(platform==='darwin'?['Contents','Home']:[]));
  // Preserve the complete upstream runtime and legal notices. Dereference the
  // upstream's relative legal symlinks into ordinary files for payload hashing.
  await cp(source,path.join(payload,'java'),{recursive:true,dereference:true});await copyFile(jar,path.join(payload,'verapdf-cli.jar'));
  const licenses=path.join(payload,'licenses');await mkdir(licenses);await copyFile(license,path.join(licenses,'veraPDF-MPL-2.0.txt'));
  for(const [name,bytes] of Object.entries(pdfValidatorNotices(await readFile(jar)))){const file=path.join(licenses,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);}
  await writeFile(path.join(payload,'SOURCES.json'),JSON.stringify({version:1,validator:{version:PDF_VALIDATOR_VERSION,artifact:pdfValidatorArtifact.url,sha256:PDF_VALIDATOR_SHA256,license:'MPL-2.0',source:'https://github.com/veraPDF/veraPDF-apps/tree/v1.30.3',components:await coordinates(path.join(licenses,'META-INF/maven'))},java:{version:artifact.version,artifact:artifact.url,sha256:artifact.sha256,license:'GPL-2.0-with-classpath-exception',source:pdfJavaSources[artifact.version],build:'https://github.com/adoptium/temurin-build',notices:'java/NOTICE',licenses:'java/legal'}},null,2)+'\n');
  const manifest={version:1,platform,arch,validatorVersion:PDF_VALIDATOR_VERSION,validatorSha256:PDF_VALIDATOR_SHA256,javaVersion:artifact.version,javaArchiveSha256:artifact.sha256,java:'java/bin/java'+(platform==='win32'?'.exe':''),jar:'verapdf-cli.jar',files:await pdfValidationFiles(payload)};await writeFile(path.join(payload,'runtime.json'),JSON.stringify(manifest,null,2)+'\n');
  for(const name of pdfValidationRuntimeFiles(platform))if(!(await lstat(path.join(payload,name.slice('pdf-validation/'.length)))).isFile())throw Error('Incomplete PDF validation runtime.');
  await rename(payload,destination);return {directory:destination,files:manifest.files.length,bytes:manifest.files.reduce((sum,row)=>sum+row.bytes,0)};
 }finally{if(path.dirname(scratch)!==scratchParent||!path.basename(scratch).startsWith('pdf-validation-'))throw Error('Invalid runtime staging path.');await rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
