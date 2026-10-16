import {AppError} from '../errors.js';
import {ResearchMaterials} from '../research-materials.js';
import {importHash,mappedId} from './import-model.js';
import {importedArtifactId} from './import-evidence.js';

export async function prepareImportedDataset(store,batch,row,content,{signal}={}){
 const materials=new ResearchMaterials(store.workspace),file=row.source.files[row.mapping.contentFile];
 const id=mappedId(batch.workspaceId,batch.source.namespace,row.source.id,row.source.revision,'dataset'),recordId=mappedId(batch.workspaceId,batch.source.namespace,row.source.id),artifactId=importedArtifactId(batch.workspaceId,recordId,file);
 const previous=await materials.current(id),mapping=row.mapping.dataset,imported=await store.read('datasets/'+id,{optional:true});
 if(previous&&(previous.kind!=='dataset'||previous.recordId!==recordId))throw new AppError('IMPORT_COLLISION');
 const conflict=!!previous&&previous.revision!==imported?.head.revision;
 const native=mapping.nativeMapping,nativeFile=native?row.source.files[native.file]:null,nativeArtifactId=nativeFile?importedArtifactId(batch.workspaceId,recordId,nativeFile):null;
 const nativeMapping=native?{...native,artifact:{kind:'artifact',id:nativeArtifactId,revision:'0'.repeat(64)}}:null;if(nativeMapping)delete nativeMapping.file;
 const command={recordId,title:row.mapping.title,artifact:{kind:'artifact',id:artifactId,revision:'0'.repeat(64)},sourceMapping:mapping.sourceMapping,...(nativeMapping?{nativeMapping}:{}),...(mapping.columns?{columns:mapping.columns}:{})};
 for(const col of mapping.columns??[])for(const ref of [col.quantity?.conversion,col.quantity?.calibration,col.time?.clock?.model,col.time?.clock?.referenceData].filter(Boolean))await materials.read(ref);
 const prepared=await materials.prepareDatasetRows(command,{source:{doc:{id:artifactId},content},nativeSize:nativeFile?.bytes,signal,writePage:operation=>store.locked(operation),
  columnDefaults:({label})=>({name:label,representation:'text',radix:10,unit:'',missing:[],time:{kind:'none',reference:'',resolution:'',uncertainty:''}})});
 const declared=row.source.attributes?.declaredRows;
 if(declared!==undefined&&declared!==prepared.content.rowCount)throw new AppError('IMPORT_ROWS',[{index:row.index,declared,actual:prepared.content.rowCount}]);
 return {id,index:row.index,previous,imported,conflict,keepAuthored:conflict&&row.mapping.resolution==='local',artifactId,recordId,title:row.mapping.title,content:prepared.content};
}

export async function commitImportedDataset(materials,prepared,store,batchId){
 const artifact=await materials.current(prepared.artifactId);if(!artifact||artifact.kind!=='artifact')throw new AppError('IMPORT_DAMAGED');
 const content={...prepared.content,inputs:[{kind:artifact.kind,id:artifact.id,revision:artifact.revision},...prepared.content.inputs.slice(1)]},current=await materials.current(prepared.id);
 if(content.nativeMapping){const old=content.nativeMapping.artifact,native=await materials.current(old.id);if(!native||native.kind!=='artifact')throw new AppError('IMPORT_DAMAGED');const pinned={kind:native.kind,id:native.id,revision:native.revision};content.nativeMapping={...content.nativeMapping,artifact:pinned};content.inputs=content.inputs.map(r=>r.id===old.id?pinned:r);}
 if(importHash(current)!==importHash(prepared.previous))throw new AppError('IMPORT_CHANGED');
 if(prepared.keepAuthored)return null;
 if(current&&current.title===prepared.title&&importHash((await materials.read(current)).content)===importHash(content))return null;
 const after=await materials.commit({kind:'dataset',id:prepared.id,recordId:prepared.recordId,title:prepared.title,expectedRevision:current?.revision??null,content});
 await store.write('datasets/'+prepared.id,{batchId,index:prepared.index,head:after});return {id:prepared.id,before:current,after,importedBefore:prepared.imported};
}
