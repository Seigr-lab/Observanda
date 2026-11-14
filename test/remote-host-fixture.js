import assert from 'node:assert/strict';
import {contentBuffer} from '../src/file-content.js';

// An in-memory web host reached over a file transfer protocol. It counts
// uploads and can fail once at a chosen operation, as a dropped connection does.
export function memoryHost(){
 const files=new Map(),directories=new Set(['/']),counts={upload:0,replace:0,remove:0};let failAt=null;
 const parent=name=>name.slice(0,name.lastIndexOf('/'))||'/';
 const maybeFail=operation=>{if(failAt===operation){failAt=null;throw Object.assign(Error('connection lost'),{code:'PUBLISH_FTP'});}};
 const session={
  async readText(file,{missing=false}={}){if(!files.has(file)){if(missing)return null;throw Error('missing');}return files.get(file).toString('utf8');},
  async writeText(file,text){files.set(file,Buffer.from(text));},
  async list(directory){const result=new Map();for(const name of [...files.keys(),...directories])if(name!==directory&&parent(name)===directory)result.set(name,{name:name.slice(directory.length+(directory==='/'?0:1)),directory:directories.has(name),size:files.get(name)?.length??0});return [...result.values()];},
  async ensureDirectory(directory){await session.ensureDirectories([directory]);},
  async ensureDirectories(list){for(const directory of list){const parts=directory.split('/').filter(Boolean);for(let i=1;i<=parts.length;i++)directories.add('/'+parts.slice(0,i).join('/'));}},
  async upload(items){for(const {content,target} of items){maybeFail('upload');assert.ok(directories.has(parent(target)),'upload into an existing folder');files.set(target,Buffer.from(await contentBuffer(content)));counts.upload++;}},
  async replace(moves){for(const {from,to} of moves){maybeFail('replace');if(!files.has(from))continue;assert.ok(directories.has(parent(to)));files.set(to,files.get(from));files.delete(from);counts.replace++;}},
  async remove(list){for(const file of list){maybeFail('remove');files.delete(file);counts.remove++;}},
  async removeTree(directory){for(const name of [...files.keys()])if(name.startsWith(directory+'/'))files.delete(name);for(const name of [...directories])if(name===directory||name.startsWith(directory+'/'))directories.delete(name);},
  async close(){}
 };
 return {files,directories,counts,fail:operation=>{failAt=operation;},transport:{open:async()=>session}};
}
