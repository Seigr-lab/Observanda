import {validProse} from '../web/prose-model.js';
import {AppError} from '../errors.js';
export const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export const text=(v,max=1000,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim())&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
export const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export const fail=(field,code='MODULE_INVALID')=>{throw new AppError(code,[{field}]);};
export const requireValue=(valid,field,code)=>{if(!valid)fail(field,code);};
export const unique=values=>new Set(values).size===values.length;
export const linksValid=links=>Array.isArray(links)&&links.every(l=>exact(l,['workspaceId','type','id'])&&uuid(l.workspaceId)&&uuid(l.id)&&/^[a-z][a-z-]{0,39}$/.test(l.type))&&unique(links.map(l=>JSON.stringify([l.workspaceId,l.type,l.id])));
export async function linkCheck(tx,links,previous=[]){
 requireValue(linksValid(links),'links');
 for(const link of links){
  if(previous.some(p=>p.workspaceId===link.workspaceId&&p.type===link.type&&p.id===link.id))continue;
  // Authenticated per-identity routing takes precedence over a stale retained
  // local copy. Unchanged links above never require the target to be unlocked.
  if(link.workspaceId!==tx.book.id||tx.externalReference&&['record','project','notebook'].includes(link.type)){
   requireValue(!!tx.externalReference&&await tx.externalReference(link),'Linked item is no longer available.','MODULE_REFERENCE');continue;
  }
  const collections={project:tx.book.projects,notebook:tx.book.notebooks};
  const exists=link.type==='record'?await tx.hasRecord(link.id):collections[link.type]?.some(e=>e.id===link.id)||await tx.has(link.type,link.id);
  requireValue(exists,'Linked item is no longer available.','MODULE_REFERENCE');
 }
}
export function saved(tx,p,type){
 requireValue(exact(p,['id','expectedRevision','data'])&&uuid(p.id),'command');
 const old=tx.get(p.id);
 requireValue(!old||old.type===type,'item type');
 tx.expect(p.id,p.expectedRevision);
 return old;
}

export const prose=(value,max=100000)=>text(value,max)||typeof value==='object'&&validProse(value,{maxCharacters:max});
