// Historical workspace searches can read immutable nodes from their project owner.
// The snapshot still pins every node hash; access and owner identities are checked
// before a bounded group of nodes is read from the independent catalogue.
import {ObjectIndex} from './object-index.js';
import {withRetiredProjectCatalogue} from './project-retired-records.js';
import {validProjectSourceAuthority} from './project-source-authority.js';
import {CatalogueReadCache} from './catalogue-read-cache.js';
import {AppError} from './errors.js';
export const retiredSearchOwnerSlot='project-source-search';
export async function retiredSearchNodes(store,ref){
 if(store.workspace.projectId)return [];
 const row=await store.db.get('SELECT payload FROM state WHERE slot=$1',retiredSearchOwnerSlot);if(!row)return [];
 const value=store.decode('state',retiredSearchOwnerSlot,row.payload);
 if(!value||Object.keys(value).sort().join()!=='owner,version'||value.version!==1||!validProjectSourceAuthority(value.owner))throw new AppError('CATALOGUE_DAMAGED');
 return withRetiredProjectCatalogue(store,value.owner,{kind:'project',id:value.owner.projectId},async selected=>{
  const cache=new CatalogueReadCache({maxRows:128,maxBytes:262144}),nodes=[],seen=new Set(),index=new ObjectIndex(selected,{namespace:'record-search-index:',immutable:true,nodeStorage:{read:async item=>{
   const slot='record-search-index:'+item.hash,row=await cache.row(slot,()=>selected.db.get('SELECT payload FROM state WHERE slot=$1',slot));return selected.decode('state',slot,row?.payload);
  }}});
  try{
   async function visit(item,required=false){
    if(!item||nodes.length===63||seen.has(item.hash))return;
    if(!required&&!cache.rows.has(index.slot(item)))return;
    seen.add(item.hash);const node=await index.node(item);nodes.push({ref:item,node});
    const children=[node.left,node.right].filter(Boolean);if(children.length)await cache.prefetch(selected.db,children.map(child=>index.slot(child)));
    await visit(node.left);await visit(node.right);
   }
   await visit(ref,true);return nodes;
  }finally{cache.clear();}
 });
}
