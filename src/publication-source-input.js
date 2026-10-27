import {preserveSourceSelection,sourceEditionReader} from './website-source-selections.js';
import {retainPublicationSources as retainLegacyPublicationSources} from './publication-source-input-legacy.js';
import {ResearchMaterials} from './research-materials.js';
import {materialRecordSummary} from './material-record-summary.js';
import {AppError} from './errors.js';
import {validPublicationSources,publicationSourceContext} from './web/publication-sources-model.js';
import {selectedPublicationRecords} from './publication-source.js';
import {retainPublicationInput,finalizePublicationInput} from './publication-input.js';
import {retainPublicationMedia} from './publication-input-media.js';
import {publicationInputState} from './publication-input-reader.js';
import {MediaStore} from './media.js';

// Foreign readers authenticate their own originals. Only explicitly selected
// record filenames and public media identities are projected into the host.
export async function retainPublicationSources(workspace,jobId,local,sources,reader,{signal,sourceReader,onCapture}={}){
 if(await workspace.storageKind()!=='catalogue')return retainLegacyPublicationSources(workspace,jobId,local,sources,reader,{signal,sourceReader});
 const state=publicationInputState(local),namespace=state.header.metadata.id,builder=state.builder;
 const indexed=!Array.isArray(sources);
 if(indexed?(!Number.isSafeInteger(sources?.count)||sources.count<0||typeof sources.get!=='function'||typeof sources.items!=='function'||await sources.get(namespace)):(!validPublicationSources(sources)||sources.some(source=>source.workspaceId===namespace)))throw new AppError('INVALID');
 if(!(indexed?sources.count:sources.length))return finalizePublicationInput(workspace,jobId,local,{signal});
 if(!reader)throw new AppError('ACCESS_LOCKED');state.header.hasSources=true;
 try{
  for await(const source of indexed?sources.items():sources){
   signal?.throwIfAborted();
   await reader.use(source.workspaceId,undefined,async(store,snapshot,pinned)=>{
    const {source:consent,metadata}=publicationSourceContext(snapshot.metadata,source,pinned.owner),owner={...pinned.owner,projectNamespaceId:pinned.projectNamespaceId};
    preserveSourceSelection(source,consent);
    const storage=new Proxy(pinned.storage,{get(target,key){if(key==='catalogue')return operation=>operation(store);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    const media=new MediaStore(pinned.storage);
    await retainPublicationInput(storage,jobId,metadata,selectedPublicationRecords(store,snapshot,{metadata,selection:consent.selection,signal}),{
     sourceEtag:pinned.snapshotId,snapshotId:pinned.snapshotId,recordHead:async id=>(await materialRecordSummary(store,await store.member(snapshot,id)))?.revision??null,signal,sourceReader,onCapture,
     deferFinalization:true,edition:source.edition,editionChoices:sourceEditionReader(source),input:local,owner,destination:workspace,identities:state.identities,
     onRecord:async record=>{
      for(const [id,publicId] of Object.entries(record.mediaIdentities)){
       signal?.throwIfAborted();if(await builder.get('retainedMedia',publicId))continue;
       const asset={...await media.get(id,{streamed:true,includeHeader:false,signal}),id:publicId};
       const [retained]=await retainPublicationMedia(workspace,jobId,[asset],{signal});await builder.append('retainedMedia',publicId,retained);
      }
     }
    });
   },{prepare:storage=>new ResearchMaterials(storage).index.ensure()});
  }
  await reader.verify();return finalizePublicationInput(workspace,jobId,local,{signal});
 }finally{await reader.close();}
}
