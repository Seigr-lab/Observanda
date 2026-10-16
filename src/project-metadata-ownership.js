// Portable ownership evidence contains only metadata exclusive to this project.
// The source-wide staging witness is removed before project publication.
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {validProjectSourceAuthority} from './project-source-authority.js';
import {digest,serialize} from './storage-format.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
const hash=value=>digest(serialize(value)),key='project:source-metadata-ownership',prefix='project-source-metadata:ownership:';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const exclusiveMetadataFact=(fact,projectId)=>fact?.projection===undefined&&(fact?.owner?.kind==='project'&&fact.owner.projectId===projectId||fact?.owner?.kind==='projects'&&fact.owner.projectIds.length===1&&fact.owner.projectIds[0]===projectId);
class Parts{
 constructor(store){this.store=store;}
 slot(kind,id){if(kind!=='ownership'||!revisionId(id))damaged();return prefix+id;}
 async read(kind,id){const slot=this.slot(kind,id),row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);if(!row)return null;const value=this.store.decode('state',slot,row.payload);if(hash(value)!==id)damaged();return value;}
 async put(kind,value){const id=hash(value),slot=this.slot(kind,id),row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);if(row){if(hash(this.store.decode('state',slot,row.payload))!==id)damaged();}else await this.store.db.run('INSERT INTO state VALUES ($1,$2)',slot,this.store.encode('state',slot,value));return id;}
}
function owner(store,receipt){if(!validProjectSourceAuthority(receipt)||store.domain!==undefined||store.workspace.projectId!==receipt.projectId||store.workspace.vault.id!==receipt.vaultId)throw new AppError('INVALID');}
function validate(value,receipt){if(!value||Object.keys(value).sort().join()!=='receipt,root,version'||value.version!==1||hash(value.receipt)!==hash(receipt)||!validTableRef(value.root))damaged();return value;}
export async function retainProjectMetadataOwnership(store,receipt,facts){
 owner(store,receipt);const prior=await store.object(key);if(prior)return validate(prior,receipt);
 const parts=new Parts(store),index=new RetainedTableIndex(parts,{namespace:'ownership',allowSparseBranches:true});let root=null,batch=[];
 const flush=async()=>{if(batch.length){root=await index.changeMany(root,batch);await index.flush(root);batch=[];}};
 for await(const fact of facts){if(!fact.id.startsWith('metadata:')||!exclusiveMetadataFact(fact,receipt.projectId))continue;batch.push({id:fact.id,revision:fact.sourceRevision});if(batch.length===32)await flush();}
 await flush();const value={version:1,receipt:structuredClone(receipt),root};await store.putObject(key,value);return value;
}
export async function retainProjectMetadataOwnershipIndex(store,receipt,root,read){
 owner(store,receipt);if(!validTableRef(root))damaged();const prior=await store.object(key);if(prior)return validate(prior,receipt);
 const parts=new Parts(store),index=new RetainedTableIndex(parts,{namespace:'ownership',allowSparseBranches:true});
 async function copy(ref){if(!ref)return;const node=index.validate(await read(ref),ref);if(node.entries?.some(entry=>!entry.id.startsWith('metadata:')))damaged();if(await parts.put('ownership',node)!==ref.hash)damaged();for(const child of node.children??[])await copy(child);}
 await copy(root);const value={version:1,receipt:structuredClone(receipt),root};await store.putObject(key,value);return value;
}
const known=new WeakMap();
async function ownership(store,receipt){
 owner(store,receipt);let promise=known.get(store);if(!promise){promise=(async()=>{const value=validate(await store.object(key),receipt);return {...value,index:new RetainedTableIndex(new Parts(store),{namespace:'ownership',allowSparseBranches:true})};})();known.set(store,promise);}const value=await promise;if(hash(value.receipt)!==hash(receipt))damaged();return value;
}
const fact=(entry,projectId)=>entry?{id:entry.id,sourceRevision:entry.revision,owner:{kind:'project',projectId}}:null;
export async function adoptedMetadataFact(store,receipt,id){const {root,index}=await ownership(store,receipt);return fact(await index.find({root},id),receipt.projectId);}
export async function adoptedMetadataPage(store,receipt,{after=null,limit=16}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>32||after!==null&&(typeof after!=='string'||!after))throw new AppError('INVALID');
 const {root,index}=await ownership(store,receipt);let ordinal=0;if(after!==null){if(!await index.find({root},after))throw new AppError('CONFLICT');ordinal=await index.rank({root},after)+1;}
 const items=[];while(ordinal<(root?.count??0)&&items.length<limit)items.push(fact(await index.entryAt({root},ordinal++),receipt.projectId));return {items,complete:ordinal===(root?.count??0),total:root?.count??0};
}
