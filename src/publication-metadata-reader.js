// Retained publication nodes share one authenticated snapshot. Only selected
// metadata reads enter it; output writers retain their original live context.
import {CatalogueReadCache} from './catalogue-read-cache.js';
import {publicationResearchWorkspace} from './publication-pin.js';
import {AppError} from './errors.js';

export async function withPublicationMetadataReader(workspace,operation,{signal}={}){
 signal?.throwIfAborted();
 if(await workspace.storageKind()!=='catalogue')return operation(workspace);
 // Edition traversal revisits authenticated index branches across many pages.
 // Keep at most 4 MiB each of encrypted rows and checked nodes, confined to
 // this immutable snapshot and cleared before its connection closes.
 const base=publicationResearchWorkspace(workspace),db=await base.openCatalogue({signal}),cache=new CatalogueReadCache({maxRows:4096,maxBytes:4*1024*1024});
 let active=true,failure;
 const check=()=>{if(!active)throw new AppError('INVALID');signal?.throwIfAborted();};
 try{
  check();await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const store=base.catalogueStore(db,{readCache:cache});
  const result=await base.withCatalogueInspection(store,async inspect=>{
   const readMetadata=async(...args)=>{
    check();return inspect(async()=>{
     check();const value=await workspace.readMetadata(...args);check();return value;
    });
   };
   const reader=new Proxy(workspace,{get(target,key){
    if(key==='readMetadata')return readMetadata;
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
   }});
   return operation(reader);
  },{signal});
  active=false;signal?.throwIfAborted();await db.run('COMMIT');return result;
 }catch(error){failure=error;throw error;}
 finally{active=false;cache.clear();try{await db.close();}catch(error){if(!failure)throw error;}}
}
