import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,symlink,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {seal} from '../src/encryption.js';
import {withNativeDestination} from '../src/native-destination.js';
import {readCatalogueArchive,inspectCatalogueArchive} from '../src/postgres-archive.js';
import {hashWorkspaceFile} from '../src/workspace-inventory.js';
import {archiveDatabaseFixture} from './archive-database-fixture.js';

const hash=value=>createHash('sha256').update(value).digest('hex'),tables={state:['slot','payload']};
function archive(text){
 const payload=seal(Buffer.from(text),randomBytes(32),'archive fixture'),row=JSON.stringify({table:'state',values:['head',payload.toString('base64')]})+'\n';
 return {payload,bytes:Buffer.from(JSON.stringify({format:'observanda-postgresql-archive',version:1})+'\n'+row+JSON.stringify({end:true,rows:1,digest:hash(row)})+'\n')};
}
for(const internal of [false,true])test(!internal&&process.platform==='win32'?'retained archive directories block Windows root replacement and preserve verified reads':`archive reads and digests stay anchored after ${internal?'internal':'root'} destination replacement`,async t=>{
 const temporary=path.resolve(os.tmpdir()),root=await mkdtemp(path.join(temporary,'observanda-native-archive-')),destination=path.join(root,'destination'),outside=path.join(root,'outside'),retained=path.join(root,'retained');
 t.after(async()=>{assert.equal(path.dirname(root),temporary);assert.ok(path.basename(root).startsWith('observanda-native-archive-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const original=archive('reviewed archive'),other=archive('unrelated outside archive'),outsideArchive=path.join(outside,internal?'catalogue.archive':'.observanda/catalogue.archive');
 await mkdir(path.dirname(outsideArchive),{recursive:true});await writeFile(outsideArchive,other.bytes);await writeFile(path.join(outside,'keep'),'outside sentinel');
 const outsideNames=await readdir(outside),file=path.join(destination,'.observanda/catalogue.archive'),written=[];let swapped=false;
 const db=archiveDatabaseFixture({async run(sql,...values){if(sql.startsWith('INSERT INTO state '))written.push(values);},async get(){return {found:1};},async all(){return [];}});
 await withNativeDestination(destination,async scope=>{
  await scope.admit({prepare:true});await scope.write(file,original.bytes);
  const replaced=internal?path.join(destination,'.observanda'):destination;
  // Windows blocks renaming an ancestor of the retained internal handle.
  // POSIX permits it; the same test must then prove the actual redirected path
  // cannot change the archive consumed by restore, inspection or hashing.
  if(!internal&&process.platform==='win32')await assert.rejects(rename(replaced,retained),error=>['EPERM','EACCES','EBUSY'].includes(error.code));
  else{await rename(replaced,retained);await symlink(outside,replaced,'junction');swapped=true;}
  await readCatalogueArchive(file,db,tables);assert.deepEqual(written,[['head',original.payload]]);
  const inspected=[];await inspectCatalogueArchive(file,tables,{row:(domain,table,values)=>inspected.push({domain,table,values})},{expectedDigest:hash(original.bytes)});
  assert.deepEqual(inspected,[{domain:null,table:'state',values:['head',original.payload]}]);
  await assert.rejects(inspectCatalogueArchive(file,tables,{row(){}},{expectedDigest:hash(other.bytes)}),{code:'CATALOGUE_DAMAGED'});
  assert.equal(await hashWorkspaceFile(file),hash(original.bytes));
  if(swapped)await assert.rejects(scope.assertNamed(),error=>['UNSAFE','STORAGE_COPY'].includes(error.code));else await scope.assertNamed();
 });
 assert.deepEqual(await readFile(outsideArchive),other.bytes);assert.equal(await readFile(path.join(outside,'keep'),'utf8'),'outside sentinel');assert.deepEqual(await readdir(outside),outsideNames);
 assert.deepEqual(await readFile(swapped?path.join(retained,internal?'catalogue.archive':'.observanda/catalogue.archive'):file),original.bytes);
});
