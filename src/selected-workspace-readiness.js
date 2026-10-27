import {open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {assertRegular,workspaceFile,Workspace} from './storage.js';
import {catalogueBinding} from './postgres-activation.js';
import {catalogueFormat} from './catalogue-format.js';
import {ResearchCatalogue,isCatalogue} from './research-catalogue.js';
import {assertCatalogueOwner,assertCatalogueEnvironment} from './project-catalogue-owner.js';
import {unseal} from './encryption.js';
import {AppError} from './errors.js';

const metadataLimit=2*1024*1024;
async function descriptorBytes(file,signal){
 const before=await assertRegular(file),handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.dev!==before.dev||stat.ino!==before.ino)throw new AppError('UNSAFE');
  if(stat.size>65536)throw new AppError('READINESS_LIMIT');
  const bytes=Buffer.alloc(stat.size+1);let used=0;
  while(used<bytes.length){signal.throwIfAborted();const part=await handle.read(bytes,used,bytes.length-used,used);if(!part.bytesRead)break;used+=part.bytesRead;}
  const after=await handle.stat();if(used!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw new AppError('CONFLICT');
  return bytes.subarray(0,used);
 }finally{await handle.close();}
}

// Uses the already-open selected environment and its reserved control client.
// It neither activates an owner nor repairs indexes, scans records or writes
// storage. A small authenticated metadata read is not a full integrity audit.
export async function selectedWorkspaceReadiness(workspace,client,{env,signal}){
 const vault=workspace.vault,ownerKey=vault?.key;if(!vault?.id||!Buffer.isBuffer(ownerKey))throw new AppError('ACCESS_LOCKED');
 const key=Buffer.from(ownerKey),current=()=>{signal.throwIfAborted();if(workspace.vault!==vault||vault.key!==ownerKey||!key.equals(ownerKey))throw new AppError('ACCESS_LOCKED');};
 const erase=()=>key.fill(0);signal.addEventListener('abort',erase,{once:true});
 let transaction=false;
 try{
  current();await assertRegular(workspace.root,{directory:true});const root=await realpath(workspace.root);current();
  if(env.OBSERVANDA_WORKSPACE_DATABASE_ROOT&&env.OBSERVANDA_WORKSPACE_DATABASE_ROOT!==root)throw new AppError('DATABASE_LOCATION');
  await assertCatalogueEnvironment(root,undefined,env);const binding=await catalogueBinding(root);if(!binding)throw new AppError('CATALOGUE_UNAVAILABLE');assertCatalogueOwner(binding);
  const file=await workspaceFile(root),bytes=await descriptorBytes(file,signal),owned=new Workspace(root,{id:vault.id,key});let descriptor;
  try{descriptor=JSON.parse(unseal(bytes,key,owned.fileAAD(file)).toString('utf8'));}catch(error){if(error instanceof AppError)throw error;throw new AppError('CATALOGUE_DAMAGED');}
  if(!isCatalogue(descriptor)||descriptor.version!==2||typeof descriptor.workspaceId!=='string')throw new AppError('CATALOGUE_DAMAGED');current();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true;
  await client.query('SET LOCAL search_path TO "obs_'+binding.id.replaceAll('-','')+'", pg_catalog');
  const db={
   all:async sql=>{if(sql!=='SELECT version FROM catalogue_format')throw new AppError('INVALID');return (await client.query(sql+' LIMIT 2')).rows;},
   get:async(sql,...values)=>{
    let query;
    if(sql==="SELECT payload FROM state WHERE slot='head'")query="FROM state WHERE slot='head'";
    else if(sql==='SELECT payload FROM snapshots WHERE id=$1')query='FROM snapshots WHERE id=$1';
    else throw new AppError('INVALID');
    const row=(await client.query('SELECT CASE WHEN pg_catalog.octet_length(payload)<='+metadataLimit+' THEN payload END AS payload, pg_catalog.octet_length(payload) AS bytes '+query+' LIMIT 1',values)).rows[0];
    if(row?.bytes>metadataLimit)throw new AppError('READINESS_LIMIT');return row;
   }
  };
  await catalogueFormat(db);const store=new ResearchCatalogue(owned,db),snapshot=await store.snapshot();
  if(snapshot.metadata.id!==descriptor.workspaceId)throw new AppError('CATALOGUE_DAMAGED');current();
  const latest=await catalogueBinding(root);if(latest?.id!==binding.id||latest?.placement!==binding.placement)throw new AppError('DATABASE_LOCATION');
  await client.query('COMMIT');transaction=false;current();
  return {catalogueIntegrity:'selected-metadata-verified',retainedContent:'not-checked',storage:'readable',storageWrites:'not-probed'};
 }finally{signal.removeEventListener('abort',erase);erase();if(transaction)try{await client.query('ROLLBACK');}catch{}}
}
