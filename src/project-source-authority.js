// A source catalogue relinquishes write authority in the same transaction as
// its handover receipt. Lookup is by selected project/scope, never by opening
// sibling databases or scanning retained workspace history on each command.
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const activeSlot='project-source-authority:active';
const projectSlot=id=>'project-source-authority:project:'+id;
const scopeSlot=id=>'project-source-authority:notebook:'+id;
const exact=(value,fields)=>value&&Object.keys(value).sort().join()===fields.sort().join();
const hash=value=>digest(serialize(value));
export function validProjectSourceAuthority(value){
 return exact(value,['version','operationId','projectId','sourceNamespace','namespaceId','vaultId','sourceHead'])&&value.version===1&&['operationId','projectId','sourceNamespace','namespaceId','vaultId'].every(key=>researchId(value[key]))&&value.sourceNamespace!==value.namespaceId&&revisionId(value.sourceHead);
}
export class ProjectSourceAuthority{
 constructor(store){this.store=store;}
 async read(slot){const row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);return row?this.store.decode('state',slot,row.payload):null;}
 async active(){if(this.store.workspace.projectId)return false;const value=await this.read(activeSlot);if(value&&(!exact(value,['version'])||value.version!==1))throw new AppError('CATALOGUE_DAMAGED');return !!value;}
 async receipt(id){
  if(!researchId(id))throw new AppError('INVALID');if(this.store.workspace.projectId)return null;
  const value=await this.read(projectSlot(id));if(value&&(!validProjectSourceAuthority(value)||value.projectId!==id))throw new AppError('CATALOGUE_DAMAGED');return value;
 }
 async writable(id){if(id===null||id===undefined)return;if(await this.receipt(id))throw new AppError('PROJECT_RELOCATED',[{projectId:id}]);}
 async notebook(id,metadata){
  if(!researchId(id))throw new AppError('INVALID');if(this.store.workspace.projectId)return;
  const current=metadata.notebooks.find(book=>book.id===id),currentId=current?.projectId??null;
  if(currentId!==null&&!researchId(currentId))throw new AppError('INVALID');
  const slots=[scopeSlot(id),...(currentId===null?[]:[projectSlot(currentId)])];
  const rows=new Map((await this.store.db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[])',slots)).map(row=>[row.slot,row.payload]));
  if(currentId!==null){
   const bytes=rows.get(projectSlot(currentId));
   if(bytes){const receipt=this.store.decode('state',projectSlot(current.projectId),bytes);if(!validProjectSourceAuthority(receipt)||receipt.projectId!==current.projectId)throw new AppError('CATALOGUE_DAMAGED');throw new AppError('PROJECT_RELOCATED',[{projectId:current.projectId}]);}
  }
  const bytes=rows.get(scopeSlot(id)),prior=bytes?this.store.decode('state',scopeSlot(id),bytes):null;
  if(prior){if(!exact(prior,['version','notebookId','projectId'])||prior.version!==1||prior.notebookId!==id||!researchId(prior.projectId))throw new AppError('CATALOGUE_DAMAGED');if(prior.projectId!==current?.projectId)await this.writable(prior.projectId);}
 }
 async recordRows(metadata,rows){if(this.store.workspace.projectId)return;const seen=new Set();for await(const row of rows){if(!row.notebookId||seen.has(row.notebookId))continue;seen.add(row.notebookId);await this.notebook(row.notebookId,metadata);}}
 async fullBookRecords(current,metadata,before,after,rows){
  const prior=new Map(before.map(row=>[row.id,row])),next=new Map(after.map(row=>[row.id,row]));
  const content=row=>{if(!row)return null;const {position,...value}=row;return value;};
  for(const id of new Set([...prior.keys(),...next.keys()])){
   const left=prior.get(id),right=next.get(id);if(hash(content(left))===hash(content(right)))continue;
   if(left)await this.notebook(left.notebookId,current.metadata);if(right)await this.notebook(right.notebookId,metadata);
  }
  // Whole-book saves rebase positions when another project's record is
  // removed. Protect each retired project's own order, not foreign offsets.
  if(!current||!before.some(row=>next.has(row.id)&&next.get(row.id).position!==row.position))return;
  const owners=new Map(),retired=new Set();
  for(const book of current.metadata.notebooks){owners.set(book.id,book.projectId);if(await this.receipt(book.projectId))retired.add(book.projectId);}
  const groups=()=>new Map([...retired].map(id=>[id,[]])),left=groups(),right=groups();
  for await(const row of this.store.members(current)){const owner=owners.get(row.notebookId);if(left.has(owner))left.get(owner).push({id:row.id,position:row.position});}
  for(const row of rows){const owner=owners.get(row.notebookId);if(right.has(owner))right.get(owner).push(row.id);}
  for(const id of retired)if(hash(left.get(id).sort((a,b)=>a.position-b.position).map(row=>row.id))!==hash(right.get(id)))await this.writable(id);
 }
 async metadata(before,after){
  if(this.store.workspace.projectId)return;
  for(const field of ['projects','notebooks','websites']){
   const previous=new Map((before?.[field]??[]).map(item=>[item.id,item])),next=new Map((after[field]??[]).map(item=>[item.id,item]));
   for(const id of new Set([...previous.keys(),...next.keys()])){
    const left=previous.get(id),right=next.get(id);if(hash(left??null)===hash(right??null))continue;
    for(const item of [left,right])if(item)await this.writable(field==='projects'?item.id:item.projectId);
    if(field==='notebooks')await this.notebook(id,after);
   }
  }
 }
 async scope(kind,id,metadata){
  if(!['notebook','website'].includes(kind)||!researchId(id))throw new AppError('INVALID');
  const value=(metadata[kind==='notebook'?'notebooks':'websites']??[]).find(item=>item.id===id);
  if(value)return {id,projectId:value.projectId,ambiguous:false};
  const saved=await this.read('project-source-scope:'+kind+':'+id);if(!saved)return null;
  if(!exact(saved,['id','projectId','ambiguous'])||saved.id!==id||!researchId(saved.projectId)||typeof saved.ambiguous!=='boolean')throw new AppError('CATALOGUE_DAMAGED');return saved;
 }
}
