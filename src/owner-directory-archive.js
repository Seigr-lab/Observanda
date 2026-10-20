// Inspect archived membership through the same authenticated native index used
// by a live owner. Only directory ciphertext is retained in encrypted scratch;
// no database, activation descriptor or other file is created in the source.
import path from 'node:path';
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {inspectCatalogueArchive} from './postgres-archive.js';
import {catalogueArchiveTables} from './postgres-archive-tables.js';
import {CATALOGUE_ARCHIVE} from './postgres-activation.js';
import {OWNER_DIRECTORY_PREFIX,validOwnerDirectoryHead} from './owner-directory-model.js';
import {digest,serialize} from './storage-format.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function inspectArchivedOwnerDirectory(registry,archiveDigest,operation,{pin}={}){
 const access=registry.directoryOwner.access,envelope=await access.envelope();
 if(!envelope.marker){if(pin)throw new AppError('INVALID');return operation(registry.directoryOwner.legacyView(envelope));}
 if(pin&&(!pin||Object.keys(pin).sort().join()!=='head,revision'||!validOwnerDirectoryHead(pin.head)||pin.head.kind!==access.kind||pin.head.ownerId!==access.ownerId||digest(serialize(pin.head))!==pin.revision||digest(serialize(pin.head.receipt))!==envelope.marker.ownerDirectory.receipt))throw new AppError('CATALOGUE_DAMAGED');
 return withScratch(async rows=>{
  let format=null;
  await inspectCatalogueArchive(path.join(access.storage.root,CATALOGUE_ARCHIVE),catalogueArchiveTables,{
   header(value){format=value.catalogueVersion??3;},
   async row(domain,table,values){if(domain===null&&table==='state'&&values[0].startsWith(OWNER_DIRECTORY_PREFIX)){
    if(!await rows.add(values[0],values[1].toString('base64')))damaged();
   }}
  },{expectedDigest:archiveDigest});
  const db={
   async get(sql,slot){if(sql!=='SELECT payload FROM state WHERE slot=$1'||!slot.startsWith(OWNER_DIRECTORY_PREFIX))damaged();const value=await rows.get(slot);return value===undefined?undefined:{payload:Buffer.from(value,'base64')};},
   async all(sql){if(sql!=='SELECT version FROM catalogue_format')damaged();return [{version:format}];}
  };
  const current=await access.current(access.storage.catalogueStore(db),envelope.marker),directory=current.directory,value=pin?.head??current.value,revision=pin?.revision??current.revision;
  return operation({revision,aliases:value.aliases,count:value.roots.active?.count??0,native:true,
   nameKey:name=>value.namePolicy==='folded'?name.normalize('NFC').toLowerCase():name,
   get:(id,options)=>directory.find(value,id,options),page:options=>directory.page(value,options),
   entries:options=>directory.rows(value,{index:'active',...options})
  });
 });
}
