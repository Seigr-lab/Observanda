import path from 'node:path';
import {AppError} from '../errors.js';
import {recordRevision} from '../research.js';
import {mappedId} from './import-model.js';

// File bytes are shared by hash, but evidence associations belong to each
// record and relative source path. Equal bytes do not imply equal provenance.
export const importedArtifactId=(workspaceId,recordId,file)=>mappedId(workspaceId,'import-evidence',recordId,file.path,file.sha256);

export async function attachImportedEvidence(store,materials,batch,row){
  const record=row.prepared.sourceRecord;
  for(const file of row.source.files){
    const id=importedArtifactId(batch.workspaceId,record.id,file),existing=await materials.current(id);
    if(existing){
      const doc=await materials.read(existing);
      if(existing.kind!=='artifact'||doc.recordId!==record.id||doc.content.sha256!==file.sha256||doc.content.size!==file.bytes||doc.content.name!==path.posix.basename(file.path)||doc.content.sourcePath!==file.path)throw new AppError('IMPORT_COLLISION');
      continue;
    }
    const original=await store.read('originals/'+file.sha256);
    await materials.commit({kind:'artifact',id,recordId:record.id,title:path.posix.basename(file.path).slice(0,255),content:{name:path.posix.basename(file.path),size:file.bytes,sha256:file.sha256,
      originalId:original.storageId,storageId:original.storageId,sourcePath:file.path,provenance:batch.source.namespace+' / '+file.path,acquisition:{kind:'record',id:record.id,revision:recordRevision(record)},inputs:[]}});
  }
}
