import {proseText} from '../web/prose-model.js';
// A list item is deliberately distinct from an entity: it cannot be submitted
// to an editor as though it contained the complete original.
export function moduleView(entity){
 const d=entity.data;
 const stock=['movement','reservation','stock-transfer','asset-transfer'].includes(entity.type);
 return {id:entity.id,type:entity.type,revision:entity.revision,createdAt:entity.createdAt,updatedAt:entity.updatedAt,openId:stock?d.resourceId:entity.id,openType:stock?'resource':entity.type,
  title:d.name??d.title??d.reason??entity.type,status:d.status??null,projectId:d.projectId??null,
  ...(entity.type==='resource'&&Object.hasOwn(d,'tags')?{tags:d.tags}:{}),
  description:proseText(d.description??d.notes??'').slice(0,240)};
}
export const moduleSearch=entity=>JSON.stringify(entity.data).toLowerCase();
