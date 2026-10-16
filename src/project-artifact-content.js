// A retired original resolves through its adopted project, with explicit
// access to that owner. Associated records retain their immutable references.
import path from 'node:path';
import {FileContent} from './file-content.js';
import {withRetiredProjectOwner} from './project-retired-records.js';
import {validProjectSourceAuthority} from './project-source-authority.js';
import {catalogueFormat} from './catalogue-format.js';
import {ResearchMaterials} from './research-materials.js';
import {assertRegular,digest} from './storage.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
export function artifactRelative(doc){
 const c=doc?.content,original=c?.originalId??doc?.id;
 if(doc?.kind!=='artifact'||!researchId(original)||c.storageId!==undefined&&!researchId(c.storageId)||!Number.isSafeInteger(c.size)||c.size<0||!revisionId(c.sha256))throw new AppError('MATERIAL_MISSING');
 return '.observanda/materials/originals/'+original+'/'+(c.storageId?c.storageId+'.original':'original');
}
export const artifactRetirementSlot=relative=>'project-source-original:'+digest(relative);
export function validArtifactRetirement(value){
 if(!value||Object.keys(value).sort().join()!=='file,notebookId,owner,phase,recordId,ref,relative,sha256,size,version'||value.version!==1||!validProjectSourceAuthority(value.owner)||!researchId(value.recordId)||!researchId(value.notebookId)||!['located','retired'].includes(value.phase)||!Number.isSafeInteger(value.size)||value.size<0||!revisionId(value.sha256)||value.ref?.kind!=='artifact'||Object.keys(value.ref).sort().join()!=='id,kind,revision'||!researchId(value.ref.id)||!revisionId(value.ref.revision))return false;
 const parts=typeof value.relative==='string'?value.relative.split('/'):[];
 return parts.length===5&&parts.slice(0,3).join('/')==='.observanda/materials/originals'&&researchId(parts[3])&&(parts[4]==='original'||parts[4].endsWith('.original')&&researchId(parts[4].slice(0,-9)))&&value.file&&Object.keys(value.file).sort().join()==='ctimeNs,dev,ino,mtimeNs,size'&&Object.values(value.file).every(n=>typeof n==='string'&&/^\d+$/.test(n));
}
export async function retiredArtifactContent(workspace,doc){
 if(workspace.projectId||await workspace.storageKind()!=='catalogue')return null;
 const relative=artifactRelative(doc),slot=artifactRetirementSlot(relative);
 const value=await workspace.catalogue(async store=>{const row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);if(!row)return null;if(await catalogueFormat(store.db)<23)throw new AppError('CATALOGUE_DAMAGED');return store.decode('state',slot,row.payload);});
 if(value===null)return null;
 if(!validArtifactRetirement(value)||value.relative!==relative||value.size!==doc.content.size||value.sha256!==doc.content.sha256)throw new AppError('CATALOGUE_DAMAGED');
 const {OwnedFileContent}=await import('./owned-file-content.js');
 return new OwnedFileContent(workspace,path.join(workspace.root,...relative.split('/')),value.size,value.sha256,consume=>workspace.catalogue(store=>withRetiredProjectOwner(store,value.owner,value.notebookId,{kind:'record',id:value.recordId},async selected=>{
  const materials=new ResearchMaterials(selected.workspace),retained=await materials.read(value.ref);
  if(retained.recordId!==value.recordId||artifactRelative(retained)!==relative||retained.content.size!==value.size||retained.content.sha256!==value.sha256)throw new AppError('CATALOGUE_DAMAGED');
  const file=await materials.artifactPath(retained);await assertRegular(file);return consume(new FileContent(selected.workspace,file,value.size,value.sha256));
 })));
}
