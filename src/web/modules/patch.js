// A partial receipt can be applied only to its declared base. Missing changes
// from another command require a fresh read, never an invented complete state.
import {t} from '../i18n/index.js';
const invalid=()=>{throw Error(t('moduleCurrent','invalid'));};
export function applyModulePatch(snapshot,patch){
 if(!patch||patch.workspaceId!==snapshot?.workspaceId||!Number.isSafeInteger(patch.baseRevision)||!Number.isSafeInteger(patch.revision)||patch.revision<patch.baseRevision||patch.revision>patch.baseRevision+1||!Array.isArray(patch.entities))invalid();
 if(snapshot.revision!==patch.baseRevision)return null;
 return {...snapshot,revision:patch.revision,entities:mergeEntities(snapshot,patch.entities)};
}

function mergeEntities(snapshot,values){
 const changed=new Map();
 for(const entity of values){
  if(!entity||typeof entity.id!=='string'||typeof entity.type!=='string'||!Number.isSafeInteger(entity.revision)||entity.revision<1||!entity.data||changed.has(entity.id))invalid();
  const previous=snapshot.entities.find(e=>e.id===entity.id);
  if(previous&&(entity.type!==previous.type||entity.revision<previous.revision))invalid();
  changed.set(entity.id,entity);
 }
 const entities=snapshot.entities.map(e=>{const value=changed.get(e.id);changed.delete(e.id);return value??e;});entities.push(...changed.values());
 return entities;
}

// Domain receipts describe selected changes, never a complete module snapshot.
export function applyModuleDomainReceipt(snapshot,receipt){
 const vector=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length>0&&Object.keys(value).length<=11&&Object.entries(value).every(([key,n])=>/^[a-z]+$/.test(key)&&Number.isSafeInteger(n)&&n>=0);
 if(!snapshot?.partial||receipt?.workspaceId!==snapshot.workspaceId||!vector(receipt.baseRevisions)||!vector(receipt.revisions)||Object.keys(receipt.baseRevisions).sort().join()!==Object.keys(receipt.revisions).sort().join()||typeof receipt.replayed!=='boolean'||!Array.isArray(receipt.changedIds)||!Array.isArray(receipt.entities))invalid();
 for(const [domain,n] of Object.entries(receipt.revisions))if(n<receipt.baseRevisions[domain]||n>receipt.baseRevisions[domain]+1||(snapshot.revisions?.[domain]??0)>n)invalid();
 if(new Set(receipt.changedIds).size!==receipt.changedIds.length||receipt.changedIds.length!==receipt.entities.length||receipt.entities.some(e=>!receipt.changedIds.includes(e?.id)))invalid();
 const {revision,...partial}=snapshot;
 return {...partial,entities:mergeEntities(snapshot,receipt.entities),revisions:{...snapshot.revisions,...receipt.revisions}};
}
