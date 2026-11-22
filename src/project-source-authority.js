// Handover receipts written by the earlier workspace-to-project conversion.
// Retired-content readers resolve their owner through these rows; nothing
// writes them any more.
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
const projectSlot=id=>'project-source-authority:project:'+id;
const exact=(value,fields)=>value&&Object.keys(value).sort().join()===fields.sort().join();
export function validProjectSourceAuthority(value){
 return exact(value,['version','operationId','projectId','sourceNamespace','namespaceId','vaultId','sourceHead'])&&value.version===1&&['operationId','projectId','sourceNamespace','namespaceId','vaultId'].every(key=>researchId(value[key]))&&value.sourceNamespace!==value.namespaceId&&revisionId(value.sourceHead);
}
export class ProjectSourceAuthority{
 constructor(store){this.store=store;}
 async read(slot){const row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);return row?this.store.decode('state',slot,row.payload):null;}
 async receipt(id){
  if(!researchId(id))throw new AppError('INVALID');if(this.store.workspace.projectId)return null;
  const value=await this.read(projectSlot(id));if(value&&(!validProjectSourceAuthority(value)||value.projectId!==id))throw new AppError('CATALOGUE_DAMAGED');return value;
 }
}
