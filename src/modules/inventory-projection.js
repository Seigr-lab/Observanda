import {ObjectIndex,validIndexRef} from '../object-index.js';
import {writeCatalogueRows} from '../catalogue-writes.js';
import {withScratch} from '../scratch-work.js';
import {digest,serialize} from '../storage-format.js';
import {AppError} from '../errors.js';
import {add,negate} from '../web/modules/quantities.js';
import {stockTracked,assetPlacement} from '../web/modules/inventory-model.js';
import {localBOMResource} from '../web/modules/bom-model.js';
import {moduleStateRow} from './read-state.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>digest(serialize(value));
const placeKey=place=>place===undefined?'~':place===null?'-':place;
export const inventoryPlace=key=>key==='~'?undefined:key==='-'?null:key;
const quantity=()=>({stockRefs:0,usageRefs:0,physical:'0',reserved:'0',used:'0',scrapped:'0',builds:0});
const total=()=>({usageRefs:0,used:'0',scrapped:'0',builds:0});
const empty=value=>Object.values(value).every(value=>value===0||value==='0');
const count=(value,delta)=>{const next=value+delta;if(!Number.isSafeInteger(next)||next<0)fail();return next;};

// Legacy stock facts without projectId follow the resource's current owner.
// Keep that lane symbolic so an ownership edit never rewrites its ledger.
export function* inventoryContributions(entity,workspaceId){
 const {type,id,data:d}=entity;
 if(type==='resource'){yield {resource:id,place:stockTracked(d)?d.projectId??null:assetPlacement(entity),scope:true};return;}
 if(type==='stock-transfer'){
  yield {resource:d.resourceId,place:d.fromProjectId,scope:true,stock:true,physical:negate(d.quantity)};
  yield {resource:d.resourceId,place:d.toProjectId,scope:true,stock:true,physical:d.quantity};return;
 }
 if(type==='movement'||type==='reservation'){
  yield {resource:d.resourceId,place:d.projectId,scope:Object.hasOwn(d,'projectId'),stock:true,physical:type==='movement'?d.delta:'0',reserved:type==='reservation'&&d.status==='active'?d.quantity:'0'};
  if(type==='reservation'&&d.managed?.settlement?.action==='finish')yield {resource:d.resourceId,place:d.projectId,usage:true,used:d.managed.settlement.used,scrapped:d.managed.settlement.scrapped,build:'managed:'+d.managed.bom.workspaceId+':'+d.managed.bom.id};
 }
 if(type==='bom'&&d.status==='finished'&&!d.externalStock){
  const lines=new Map(d.lines.map(line=>[line.id,line]));
  for(const usage of d.usage){const line=lines.get(usage.lineId),resource=localBOMResource(line,workspaceId);if(resource)yield {resource,place:line.sourceProjectId,usage:true,used:usage.used,scrapped:usage.scrapped,build:'local:'+id};}
 }
}

// The same delta algebra serves transactional maintenance and the independent
// full-ledger reconciliation. Only the latter reads every retained fact.
async function applyContribution(change,item,direction){
 const place=placeKey(item.place),q='quantity:'+item.resource+':'+place,t='total:'+item.resource;
 const adjust=(value,delta)=>add(value,direction===1?delta:negate(delta));
 const reference=async key=>{let transition;await change(key,previous=>{const before=previous?.count??0,after=count(before,direction);transition=Number(after>0)-Number(before>0);return after?{count:after}:null;});return transition;};
 if(item.scope)await reference('scope:'+place+':'+item.resource);
 if(item.stock||item.usage)await change(q,previous=>{
  const value=previous??quantity();value.stockRefs=count(value.stockRefs,item.stock?direction:0);value.usageRefs=count(value.usageRefs,item.usage?direction:0);
  for(const key of ['physical','reserved','used','scrapped'])value[key]=adjust(value[key],item[key]??'0');return empty(value)?null:value;
 });
 if(item.usage)await change(t,previous=>{const value=previous??total();value.usageRefs=count(value.usageRefs,direction);for(const key of ['used','scrapped'])value[key]=adjust(value[key],item[key]??'0');return empty(value)?null:value;});
 if(item.build){
  const local=await reference('build:'+item.resource+':'+place+':'+item.build),global=await reference('build-total:'+item.resource+':'+item.build);
  if(local)await change(q,previous=>{const value=previous??quantity();value.builds=count(value.builds,local);return empty(value)?null:value;});
  if(global)await change(t,previous=>{const value=previous??total();value.builds=count(value.builds,global);return empty(value)?null:value;});
 }
}

export class InventoryProjection{
 constructor(catalogue){this.catalogue=catalogue;this.store=catalogue.store;this.tree=new ObjectIndex(this.store,{namespace:'module-stock-index:',cacheReads:true});}
 static valid(value){return value?.version===1&&Object.keys(value).sort().join()==='root,version'&&validIndexRef(value.root);}
 check(head){if(head.stockIndex!==undefined&&!InventoryProjection.valid(head.stockIndex))fail();}
 available(head){this.check(head);return !!head.stockIndex||(head.memberVersion===1?head.root?.count??0:head.entities.length)===0;}
 async value(entry){
  if(!entry)return null;const slot='module-stock-value:'+digest(entry.id),row=await moduleStateRow(this.store,slot);if(!row)fail();
  const value=this.store.decode('state',slot,row.payload);if(value?.id!==entry.id||hash(value)!==entry.revision)fail();return value.value;
 }
 async get(head,id){this.check(head);return this.value(await this.tree.find(head.stockIndex??{root:null},id));}
 async *entries(head,prefix,{signal}={}){
  this.check(head);const index=head.stockIndex??{root:null},lower=await this.tree.rank(index,prefix),upper=await this.tree.rank(index,prefix+'\uffff');
  for(let at=lower;at<upper;at++){signal?.throwIfAborted();const entry=await this.tree.entryAt(index,at);if(!entry?.id.startsWith(prefix))fail();yield {id:entry.id,value:await this.value(entry)};}
 }
 async flush(){
  const {tree,store}=this;function* rows(){for(const [key,node] of tree.writes)yield [key,node===null?null:store.encode('state',key,node)];}
  await writeCatalogueRows(store.db,'state',rows());for(const node of tree.writes.values())if(node)tree.cacheNode({key:digest(node.id),hash:hash(node)},node);
  tree.pending.clear();tree.pendingBytes=0;tree.writes.clear();
 }
 async replace(root,before,after,workspaceId){
  const change=async(id,update)=>{
   const prior=await this.value(await this.tree.find({root},id)),value=update(prior),slot='module-stock-value:'+digest(id),wrapped=value===null?null:{id,value};
   await writeCatalogueRows(this.store.db,'state',[[slot,wrapped===null?null:this.store.encode('state',slot,wrapped)]]);
   root=await this.tree.change(root,id,wrapped===null?null:hash(wrapped));if(this.tree.writes.size>=128||this.tree.pendingBytes>=1024*1024)await this.flush();
  };
  if(before)for(const item of inventoryContributions(before,workspaceId))await applyContribution(change,item,-1);
  if(after)for(const item of inventoryContributions(after,workspaceId))await applyContribution(change,item,1);
  await this.flush();return root;
 }
 async prepare(head){
  this.check(head);if(head.stockIndex)return head.stockIndex.root;
  let root=null;for await(const member of this.catalogue.members(head))root=await this.replace(root,null,await this.catalogue.constraint(head,member),head.workspaceId);return root;
 }
 async verify(head){
  this.check(head);if(!head.stockIndex)return;
  await withScratch(async work=>{
   let count=0;const change=async(id,update)=>{const prior=await work.get(id),value=update(prior?.value??null);count+=Number(value!==null)-Number(!!prior);if(value===null)await work.remove(id);else await work.put(id,{id,value});};
   for await(const member of this.catalogue.members(head))for(const item of inventoryContributions(await this.catalogue.constraint(head,member),head.workspaceId))await applyContribution(change,item,1);
   if(count!==(head.stockIndex.root?.count??0))fail();
   for await(const expected of work.items()){const actual=await this.get(head,expected.id);if(hash(actual)!==hash(expected.value))fail();}
  });
 }
}

export async function projectedStockBalance(plans,resourceId,owner,projects){
 let physical='0',reserved='0';
 for(const {index,head} of plans)for await(const {id,value} of index.entries(head,'quantity:'+resourceId+':')){
  const place=inventoryPlace(id.slice(('quantity:'+resourceId+':').length));if(projects&&!projects.has(place===undefined?owner:place))continue;
  physical=add(physical,value.physical);reserved=add(reserved,value.reserved);
 }
 return {physical,reserved,available:add(physical,negate(reserved))};
}

export async function mergeInventoryProjection(plans,resources,row,{work,scope,signal}={}){
 for(const item of resources.values())for(let owner=0;owner<plans.length;owner++){
  signal?.throwIfAborted();
  const {index,head}=plans[owner];
  for await(const {id,value} of index.entries(head,'quantity:'+item.id+':',{signal})){
   const key=inventoryPlace(id.slice(('quantity:'+item.id+':').length)),place=key===undefined?item.data.projectId??null:key;
   if(!stockTracked(item.data)&&!value.usageRefs)continue;const target=row(item,place);
   for(const field of ['used','scrapped'])target[field]=add(target[field],value[field]);target.builds+=value.builds;
   if(stockTracked(item.data))for(const field of ['physical','reserved'])target[field]=add(target[field],value[field]);
   if(scope?.has(place))for(const field of ['used','scrapped'])item.usage[field]=add(item.usage[field],value[field]);
  }
  if(!scope){const value=await index.get(head,'total:'+item.id);if(value){for(const field of ['used','scrapped'])item.usage[field]=add(item.usage[field],value[field]);item.usage.builds+=value.builds;}}
  else for(const place of scope){const prefix='build:'+item.id+':'+placeKey(place)+':';for await(const {id} of index.entries(head,prefix,{signal}))if(await work.add(JSON.stringify([owner,item.id,id.slice(prefix.length)])))item.usage.builds++;}
 }
 signal?.throwIfAborted();
}

export async function projectedInventoryScope(plans,scope,{signal}={}){
 signal?.throwIfAborted();const visible=new Set();for(const {index,head} of plans)for(const place of scope)for await(const {id} of index.entries(head,'scope:'+placeKey(place)+':',{signal}))visible.add(id.slice(-36));signal?.throwIfAborted();return visible;
}
