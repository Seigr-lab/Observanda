// Prepared media remains owned by its explicitly assigned import. The sealed
// original proves that relationship; a record attachment alone never does.
import {MediaImports} from './media-imports.js';
import {AppError} from './errors.js';
export async function importedMediaOwner(workspace,metadata,resolveImport){
 const id=metadata.id;if(!metadata.storageId)return null;
 const session=await new MediaImports(workspace).read(id);
 if(metadata.kind!==session.kind||!session.source||metadata.originalBytes!==session.source.size||metadata.originalSha256!==session.source.sha256||metadata.kind==='file'&&(metadata.storageId!==session.source.storageId||metadata.name!==session.name))throw new AppError('MEDIA_INVALID');
 const owner=await resolveImport(id);return owner?owner.kind==='project'?{kind:'project',projectId:owner.projectId}:{kind:'workspace'}:null;
}
