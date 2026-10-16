// Check every owned evidence path component before reading or retiring a file.
import path from 'node:path';
import {lstat} from 'node:fs/promises';
import {assertRegular} from './storage.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export async function evidenceFileStamp(root,relative,{missing=false}={}){
 const parts=typeof relative==='string'?relative.split('/'):[];
 if(parts.length!==5||parts[0]!=='.observanda'||parts[1]!=='materials'||!researchId(parts[3])||!(parts[2]==='imports'&&/^(0|[1-9][0-9]*)\.chunk$/.test(parts[4])||parts[2]==='originals'&&(parts[4]==='original'||parts[4].endsWith('.original')&&researchId(parts[4].slice(0,-9)))))throw new AppError('UNSAFE');
 let file=root;await assertRegular(file,{directory:true});for(const part of parts.slice(0,-1)){file=path.join(file,part);await assertRegular(file,{directory:true});}file=path.join(file,parts.at(-1));let stat;
 try{stat=await lstat(file,{bigint:true});}catch(error){if(missing&&error.code==='ENOENT')return null;throw error;}if(!stat.isFile()||stat.nlink!==1n)throw new AppError('UNSAFE');return Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs'].map(key=>[key,String(stat[key])]));
}
