import {cp,lstat,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {payloadFiles} from './desktop-payload.js';

// The Windows extra-resource copier signs every .exe. The bundled runtimes
// already have reviewed upstream bytes and must keep their original signatures.
export async function installWindowsPayload(prepared,resources,manifest){
 if(!manifest||manifest.platform!=='win32')throw Error('The reviewed Windows payload is missing.');
 const roots=new Set(manifest.files.map(file=>file.path.split('/')[0]));
 roots.add('payload.json');
 const names=await readdir(prepared);
 if(names.length!==roots.size||names.some(name=>!roots.has(name))||names.some(name=>['app.asar','package-type'].includes(name.toLowerCase())))throw Error('Unexpected prepared Windows payload layout.');
 const occupied=new Set((await readdir(resources)).map(name=>name.toLowerCase()));
 if(names.some(name=>occupied.has(name.toLowerCase())))throw Error('A desktop resource would overwrite an existing package file.');
 for(const name of names){
  await cp(path.join(prepared,name),path.join(resources,name),{recursive:true,force:false,errorOnExist:true,verbatimSymlinks:true});
 }
}

export async function verifyWindowsPayload(resources,manifest,{installed=false}={}){
 if(!manifest||manifest.platform!=='win32')throw Error('The reviewed Windows payload is missing.');
 const packagedManifest=JSON.parse(await readFile(path.join(resources,'payload.json'),'utf8'));
 if(JSON.stringify(packagedManifest)!==JSON.stringify(manifest))throw Error('The packaged Windows manifest differs from the reviewed manifest.');
 if(!(await lstat(path.join(resources,'app.asar'))).isFile())throw Error('The Windows application archive is missing.');
 // NSIS writes this four-byte marker during installation, after extraction.
 if(installed){
  const marker=path.join(resources,'package-type');
  if(!(await lstat(marker)).isFile()||!(await readFile(marker)).equals(Buffer.from('nsis')))throw Error('Invalid Windows installation marker.');
 }
 const files=(await payloadFiles(resources)).filter(file=>file.path!=='app.asar'&&!(installed&&file.path==='package-type'));
 if(JSON.stringify(files)!==JSON.stringify(manifest.files))throw Error('Packaged Windows resource bytes differ from the reviewed payload.');
}
