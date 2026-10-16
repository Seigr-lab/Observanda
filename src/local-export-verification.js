// A portable backup promises the export journal and ownership receipts, not
// the external destination directory. Verify every retained index without
// touching output files or resuming publication during a storage audit.
import {LocalExport} from './local-export.js';
import {digest} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const prefix='.observanda/local-exports/';
const fail=()=>{throw new AppError('LOCAL_EXPORT_DAMAGED');};
export async function verifyLocalExports(workspace){
 const service=new LocalExport(workspace);
 for await(const file of workspace.metadataNames(prefix.slice(0,-1))){
  if(file==='owners'||file==='reviews')continue;
  if(!file.endsWith('.json')||!researchId(file.slice(0,-5)))fail();
  await service.verifyPlan(await service.get(file.slice(0,-5)));
 }
 for await(const file of workspace.metadataNames(prefix+'owners')){
  if(!/^[a-f0-9]{64}\.json$/.test(file))fail();const owner=await service.read(prefix+'owners/'+file);service.validateOwner(owner,owner?.directory);
  // A Windows receipt may later be read on another platform. Its path remains
  // a historical destination; either platform's authenticated spelling is valid.
  if(![digest(owner.directory),digest(owner.directory.toLowerCase())].includes(file.slice(0,-5)))fail();
  if(owner.version===2)for await(const item of service.manifest.entries(owner.files))void item;
  if(owner.pending&&(await service.get(owner.pending)).directory!==owner.directory)fail();
 }
 for await(const file of workspace.metadataNames(prefix+'reviews')){
  if(!/^[a-f0-9]{64}\.json$/.test(file))fail();const pointer=await service.read(prefix+'reviews/'+file);
  if(!researchId(pointer?.id)||(await service.get(pointer.id)).reviewId!==file.slice(0,-5))fail();
 }
}
