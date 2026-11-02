import {parseFragment} from 'parse5';
import {createHash,randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {attr,descendants} from './website-migration-views.js';
import {projectedRecordMetadata,projectedSourceOverview} from './website-source-overview.js';
import {websiteSearchFields,fold} from './website-file-library-fields.js';
import {libraryQuery,matchesQuery,compareLibraryRows,fingerprint,libraryCursor,readLibraryCursor} from './website-file-library-query.js';

const root='.observanda/website-files',index=root+'/picker',generation=index+'/generation.json';
const views=new WeakMap(),legacyViews=new WeakMap(),validId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
const shardFile=id=>index+'/'+id.slice(0,2)+'.json';
const scanLimit=4096,olderLimit=40,searchKeyBudget=8*1024*1024;
const concealed=node=>['script','style','template','noscript'].includes(node.tagName)||node.attrs?.some(a=>a.name==='hidden'||a.name==='aria-hidden'&&a.value==='true');
function shown(node){for(let parent=node;parent;parent=parent.parentNode)if(concealed(parent))return false;return true;}

// Only text from the already permitted website fragment is used. Never open
// its source record, attachments or a research catalogue to build a preview.
function excerpt(root,title){
 const parts=[];let length=0;
 function visit(node){
  if(length>=240||concealed(node))return;
  if(node.nodeName==='#text'){const part=node.value.slice(0,1000).replace(/\s+/gu,' ').trim();if(part&&part!==title){parts.push(part);length+=part.length+1;}return;}
  for(const child of node.childNodes??[]){visit(child);if(length>=240)break;}
 }
 visit(root);return [...parts.join(' ')].slice(0,200).join('');
}
function describe(source,preview='',context={}){
 const media=source.assets.some(f=>/^(?:image|audio|video)\//.test(f.contentType));
 const {recordId,notebookId,projectId=null,workspaceId=null}=source.provenance??{};
 return {id:source.id,revision:source.revision,title:source.title,media,preview,projectId,workspaceId,...(recordId?{recordId,notebookId}:{}),projectTitle:context.projectTitle??null,notebookTitle:context.notebookTitle??null,displayDate:context.displayDate??null};
}
async function shard(store,id){return await store.control(shardFile(id),{missing:true})??{};}
export async function indexWebsiteSource(store,source,html,signal,context){
 const entries=await shard(store,source.id);
 // A tombstone also distinguishes a processed private/PDF source from one
 // written before the compact index existed. Never retain its title or text.
 let item=null;
 if(source.visible&&source.target==='website'){
  const fragment=parseFragment(html);
  item={...describe(source,excerpt(fragment,source.title),context),...websiteSearchFields(fragment)};
 }
 entries[source.id]=item;
 await store.writeControl(shardFile(source.id),entries,{signal});
 await store.writeControl(generation,randomUUID(),{signal});
}
// Called by the producer under the file writer. Enrich an existing projection
// without recopying the entry, reopening its body or changing a website head.
export async function enrichWebsiteSources(store,rows,signal){
 const groups=Map.groupBy(rows,row=>row.source.id.slice(0,2));let changed=false;
 for(const [prefix,group] of groups){
  const entries=await shard(store,prefix);let dirty=false;
  for(const {source,context} of group){
   const prior=entries[source.id];if(prior===null||prior&&prior.revision!==source.revision)throw new AppError('CONFLICT');
   const next={...prior,...describe(source,prior?.preview,{...context,displayDate:prior?.displayDate})};
   if(!prior||Object.keys(next).some(k=>next[k]!==prior[k])){entries[source.id]=next;dirty=true;}
  }
  if(dirty){await store.writeControl(shardFile(prefix),entries,{signal});changed=true;}
 }
 if(changed)await store.writeControl(generation,randomUUID(),{signal});
}
async function version(store){return store.control(generation,{missing:true,limit:128});}
export async function libraryStamp(store){
 const generation=await version(store),pending=await store.pendingSources();
 const visibilityToken=createHash('sha256').update(JSON.stringify([generation,[...pending].sort()])).digest('hex');
 return {generation,pending,visibilityToken};
}
export async function checkLibraryStamp(store,stamp){
 if((await libraryStamp(store)).visibilityToken!==stamp.visibilityToken)throw new AppError('WEBSITE_CHANGED');
}
async function ids(store,scope,signal){
 const result=[];
 await scope.member(store.absolute(root+'/sources/sentinel'),async directory=>{
  if(!directory)return;
  for await(const entry of directory.entries()){
   signal?.throwIfAborted();if(entry.directory&&validId(entry.name))result.push(entry.name);
  }
 },{missing:true});
 return result.sort();
}
async function census(store,scope,epoch,signal){
 const vault=store.workspace.vault;
 for(;;){
  signal?.throwIfAborted();
  let view=views.get(vault);
  if(view&&view.epoch===epoch&&view.root===store.workspace.root){
   if(view.names)return view;
   try{await view.loading;signal?.throwIfAborted();return view;}
   catch(error){if(!view.cancelled||signal?.aborted)throw error;continue;}
  }
  view={epoch,root:store.workspace.root};views.set(vault,view);
  view.loading=ids(store,scope,signal).then(names=>{view.names=names;}).catch(error=>{
   view.cancelled=signal?.aborted===true;
   if(views.get(vault)===view)views.delete(vault);throw error;
  });
  await view.loading;return view;
 }
}
async function visitWindow(store,names,at,stamp,{signal,visit}){
 let visited=0,older=0,groups=0,group=null,metadata;
 for(;at<names.length&&visited<scanLimit&&older<olderLimit;at++,visited++){
  signal?.throwIfAborted();const id=names[at];if(stamp.pending.has(id))continue;
  if(group!==id.slice(0,2)){if(++groups>32)break;group=id.slice(0,2);metadata=await shard(store,id);}
  let item=metadata[id];
  if(item===undefined||item&&item.searchVersion!==1){
   // Recover only approved fields from a saved fragment when its compact
   // metadata predates those fields. PDF and withdrawn sources have no row.
   const vault=store.workspace.vault;let cache=legacyViews.get(vault);
   if(cache?.token!==stamp.visibilityToken||cache.root!==store.workspace.root){cache={token:stamp.visibilityToken,root:store.workspace.root,rows:new Map(),bytes:0};legacyViews.set(vault,cache);}
   if(cache.rows.has(id))item=cache.rows.get(id).item;
   else{
    older++;const source=await store.source(id,{pending:true});
    if(!source?.visible||source.target!=='website')item=null;
    else{
     const fragment=parseFragment(await store.readText(source.html,{signal})),prior=item?.revision===source.revision?item:null;
     item={...describe(source,prior?.preview??excerpt(fragment,source.title),prior??{}),...websiteSearchFields(fragment)};
    }
    const bytes=128+Buffer.byteLength(JSON.stringify(item))*2;
    if(bytes<=2*1024*1024){
     while(cache.bytes+bytes>2*1024*1024){const first=cache.rows.keys().next().value;cache.bytes-=cache.rows.get(first).bytes;cache.rows.delete(first);}
     if(!cache.rows.has(id)){cache.rows.set(id,{item,bytes});cache.bytes+=bytes;}
    }
   }
  }
  if(!item)continue;
  if(item.id!==id||!validId(item.revision)||typeof item.title!=='string'||typeof item.media!=='boolean')throw new AppError('FORMAT');
  if(visit(item)===false){at++;break;}
 }
 return at;
}
async function sourceRows(store,names,stamp,signal){
 const ordered=[...names].sort(),rows=new Map();let at=0;
 while(at<ordered.length)at=await visitWindow(store,ordered,at,stamp,{signal,visit:row=>{rows.set(row.id,row);}});
 if(rows.size!==names.length){await checkLibraryStamp(store,stamp);throw new AppError('FORMAT');}
 return names.map(id=>rows.get(id));
}
function addOwner(map,id,title,extra={}){
 const prior=map.get(id);if(!prior||title&&!prior.title)map.set(id,{id,title:title??null,fallback:!title,...extra,count:prior?.count??0});
 map.get(id).count++;
}
async function facetWindow(store,view,stamp,signal){
 if(view.facets?.token!==stamp.visibilityToken)view.facets={token:stamp.visibilityToken,at:0,count:0,project:new Map(),book:new Map(),keys:new Map(),keyBytes:0,orders:new Map(),walks:new Map()};
 const facets=view.facets;
 if(facets.at<view.names.length){
  facets.busy??=(async()=>{
   facets.readerSignal=signal;
   const window=[],at=await visitWindow(store,view.names,facets.at,stamp,{signal,visit:item=>{window.push(item);}});
   await checkLibraryStamp(store,stamp);
   for(const item of window){
    if(item.projectId)addOwner(facets.project,item.projectId,item.projectTitle);
    if(item.notebookId)addOwner(facets.book,item.notebookId,item.notebookTitle,{projectId:item.projectId??null,projectTitle:item.projectTitle??null});
    if(facets.keys){
     const {preview,revision,...key}=item;facets.keyBytes+=Buffer.byteLength(JSON.stringify(key))*2;
     if(facets.keyBytes>searchKeyBudget)facets.keys=null;else facets.keys.set(item.id,key);
    }
   }
   facets.count+=window.length;facets.at=at;
  })().finally(()=>{facets.busy=null;});
  const reader=facets.readerSignal;
  try{await facets.busy;}catch(error){if(reader?.aborted&&!signal?.aborted)return facetWindow(store,view,stamp,signal);throw error;}
 }
 return facets;
}
function result(items,next,stamp,extra={}){
 return {items,next,generation:stamp.generation,visibilityToken:stamp.visibilityToken,...extra};
}
function sortedPoint(row){return {id:row.id,title:row.title,dateFrom:row.dateFrom??null,dateTo:row.dateTo??null};}
function validPoint(point){return validId(point?.id)&&typeof point.title==='string'&&point.title.length<=200&&[point.dateFrom,point.dateTo].every(d=>d===null||typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d));}
function boundedInsert(rows,row,compare,limit){
 let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>>1;if(compare(rows[m],row)<0)lo=m+1;else hi=m;}
 if(lo<limit){rows.splice(lo,0,row);if(rows.length>limit)rows.pop();}
}
// Keep only one page of candidates under cache pressure. Unfinished scans
// occupy a bounded number of short-lived slots and never carry private text.
async function walkPage(store,view,facets,stamp,key,point,signal,make,visit){
 const scans=facets.walks;
 let id=point?.walk,state=id&&scans.get(id);
 if(id&&(!state||state.key!==key||state.at!==point.at||state.busy))throw new AppError('WEBSITE_CHANGED');
 if(!state){
  while(scans.size>=8){const oldest=[...scans].find(([,v])=>!v.busy);if(!oldest)throw new AppError('WORKLOAD_BUSY');scans.delete(oldest[0]);}
  id=randomUUID();state={key,at:0,data:make()};scans.set(id,state);
 }
 state.busy=true;
 try{
  state.at=await visitWindow(store,view.names,state.at,stamp,{signal,visit:row=>visit(state.data,row)});
  if(state.at<view.names.length)return {next:{...point,walk:id,at:state.at}};
  scans.delete(id);return {data:state.data};
 }catch(error){scans.delete(id);throw error;}finally{state.busy=false;}
}
async function sortedLarge(store,view,facets,stamp,key,q,point,limit,signal){
 const order=(a,b)=>compareLibraryRows(a,b,q.sort,q.locale),seek=point?.seek??null;
 if(seek&&!validPoint(seek))throw new AppError('INVALID');
 if(!point?.walk){
  const {pinnedQueryResults}=await import('./pinned-query-result.js');
  const sorted=await pinnedQueryResults.window({workspace:store.workspace,ownerId:store.workspace.vault.id,snapshotId:stamp.visibilityToken,queryHash:key,order,point:sortedPoint,after:seek,limit,signal},async check=>({
   rows:(async function*(){
    let at=0;while(at<view.names.length){check();const window=[];
     at=await visitWindow(store,view.names,at,stamp,{signal,visit:item=>{if(matchesQuery(item,q))window.push(sortedPoint(item));}});
     await checkLibraryStamp(store,stamp);yield* window;
    }
   })()
  }));
  if(sorted){
   const items=await sourceRows(store,sorted.records.map(r=>r.id),stamp,signal);
   return {items,next:sorted.skipped+items.length<sorted.total?{seek:sorted.records.at(-1)}:null};
  }
 }
 const page=await walkPage(store,view,facets,stamp,key+':'+limit,point,signal,()=>[],(rows,row)=>{
  if(matchesQuery(row,q)&&(!seek||order(row,seek)>0))boundedInsert(rows,sortedPoint(row),order,limit+1);
 });
 if(page.next)return {items:[],next:page.next};
 const retained=page.data.slice(0,limit);
 return {items:await sourceRows(store,retained.map(row=>row.id),stamp,signal),next:page.data.length>limit?{seek:retained.at(-1)}:null};
}
export async function searchWebsiteLibrary(store,scope,options={}){
 const {after=null,limit=20,signal}=options,q=libraryQuery(options),key=fingerprint([store.workspace.root,store.workspace.vault.id,'entries',q]);
 if(!Number.isInteger(limit)||limit<1||limit>40)throw new AppError('INVALID');
 const stamp=await libraryStamp(store),point=readLibraryCursor(after,key,stamp),view=await census(store,scope,stamp.generation,signal);
 let facets=view.facets,items=[],next=null;
 if(q.sort!=='default')facets=await facetWindow(store,view,stamp,signal);
 const ready=facets?.token===stamp.visibilityToken&&facets.at===view.names.length;
 if(q.sort!=='default'&&!ready)next={build:facets.at};
 else if(q.sort!=='default'&&!facets.keys)({items,next}=await sortedLarge(store,view,facets,stamp,key,q,point,limit,signal));
 else if(ready&&facets.keys){
  let names=view.names;
  if(q.sort!=='default'){
   const orderKey=q.sort+(q.sort.startsWith('title')?q.locale:'');
   if(!facets.orders.has(orderKey)){
    if(facets.orders.size>=4)facets.orders.delete(facets.orders.keys().next().value);
    facets.orders.set(orderKey,[...facets.keys.values()].sort((a,b)=>compareLibraryRows(a,b,q.sort,q.locale)).map(row=>row.id));
   }
   names=facets.orders.get(orderKey);
  }
  let at=point?.offset??0;if(!Number.isSafeInteger(at)||at<0||at>names.length)throw new AppError('INVALID');
  const candidates=[],through=Math.min(names.length,at+scanLimit);
  for(;at<through&&candidates.length<limit;at++){const item=facets.keys.get(names[at]);if(item&&matchesQuery(item,q))candidates.push(item.id);}
  items=await sourceRows(store,candidates,stamp,signal);if(at<names.length)next={offset:at};
 }else{
  const start=point?.offset??0;if(!Number.isSafeInteger(start)||start<0||start>view.names.length)throw new AppError('INVALID');
  const at=await visitWindow(store,view.names,start,stamp,{signal,visit:item=>{if(matchesQuery(item,q))items.push(item);return items.length<limit;}});
  if(at<view.names.length)next={offset:at};
 }
 await checkLibraryStamp(store,stamp);return result(items,next&&libraryCursor(key,stamp,next),stamp);
}
const tagCounts=()=>({counts:new Map(),items:[]});
function tagCandidate({counts,items},tag,after,needle,limit){
 if(after!==null&&tag<=after||!fold(tag).includes(needle))return;
 const prior=counts.get(tag);if(prior){prior.count++;return;}
 if(items.length>limit){const last=items.at(-1).id;if(tag>=last)return;counts.delete(last);}
 const item={id:tag,title:tag,count:1};counts.set(tag,item);
 boundedInsert(items,item,(a,b)=>a.id<b.id?-1:a.id>b.id?1:0,limit+1);
}
export async function websiteLibraryFacets(store,scope,{kind,projectId=null,notebookId=null,criteria={},search='',after=null,limit=24,signal}={}){
 if(!['book','project','tag'].includes(kind)||projectId!==null&&!researchId(projectId)||notebookId!==null&&!researchId(notebookId)||typeof search!=='string'||search.length>160||!Number.isInteger(limit)||limit<1||limit>100||!criteria||typeof criteria!=='object'||Array.isArray(criteria))throw new AppError('INVALID');
 const q=libraryQuery({...criteria,...(projectId?{projectId}:{}),...(notebookId?{notebookId}:{})}),needle=fold(search.trim()),key=fingerprint([store.workspace.root,store.workspace.vault.id,'facets',kind,needle,q]);
 const stamp=await libraryStamp(store),point=readLibraryCursor(after,key,stamp),view=await census(store,scope,stamp.generation,signal),facets=await facetWindow(store,view,stamp,signal);
 const page=(items,next,extra)=>result(items,next&&libraryCursor(key,stamp,next),stamp,extra);
 await checkLibraryStamp(store,stamp);
 if(facets.at<view.names.length)return page([],{build:facets.at});
 const cursor=point?.last??null;
 if(cursor!==null&&(typeof cursor!=='string'||cursor.length>40))throw new AppError('INVALID');
 if(kind==='tag'){
  // In ANY mode a further tag broadens the result. Tags that never occur
  // alongside a current choice still belong in the suggestions.
  const peers=q.tagMode==='any'?{...q,tags:[]}:q;
  const visit=(rows,item)=>{if(matchesQuery(item,peers))for(const tag of new Set(item.tags))tagCandidate(rows,tag,cursor,needle,limit);};
  let rows;
  if(facets.keys){rows=tagCounts();for(const item of facets.keys.values()){signal?.throwIfAborted();visit(rows,item);}}
  else{
   const scan=await walkPage(store,view,facets,stamp,key+':'+limit,point,signal,tagCounts,visit);
   await checkLibraryStamp(store,stamp);if(scan.next)return page([],scan.next);rows=scan.data;
  }
  const items=rows.items;
  const more=items.length>limit;if(more)items.pop();await checkLibraryStamp(store,stamp);
  return page(items,more?{last:items.at(-1).id}:null,{totalEntries:facets.count});
 }
 const items=[];let more=false;
 for(const row of facets[kind].values()){
  if(cursor&&row.id<=cursor||kind==='book'&&projectId&&projectId!==row.projectId||!fold([row.title,row.projectTitle,row.id].join(' ')).includes(needle))continue;
  boundedInsert(items,row,(a,b)=>a.id.localeCompare(b.id),limit+1);
 }
 if(items.length>limit){items.pop();more=true;}
 return page(items,more?{last:items.at(-1).id}:null,{totalEntries:facets.count});
}
export async function validateWebsiteLibraryRows(store,{items,generation:prior,signal}={}){
 if(!Array.isArray(items)||items.length>40||items.some(r=>!validId(r?.id)||!validId(r.revision)))throw new AppError('INVALID');
 const stamp=await libraryStamp(store),accepted=[];
 for(const row of items){
  signal?.throwIfAborted();if(stamp.pending.has(row.id))continue;
  if(prior!==stamp.generation||stamp.generation===null){
   const source=await store.source(row.id,{pending:true});
   if(!source?.visible||source.target!=='website'||source.revision!==row.revision)continue;
  }
  accepted.push(row.id);
 }
 await checkLibraryStamp(store,stamp);
 return {accepted,generation:stamp.generation,visibilityToken:stamp.visibilityToken};
}
export async function previewWebsiteSource(store,id,revision,signal,sectionAfter=0){
 sectionAfter??=0;if(!Number.isSafeInteger(sectionAfter)||sectionAfter<0)throw new AppError('INVALID');
 const stamp=await libraryStamp(store),source=await store.source(id);
 if(!source?.visible||source.target!=='website')throw new AppError('NOT_FOUND');
 if(source.revision!==revision)throw new AppError('CONFLICT');
 const fragment=parseFragment(await store.readText(source.html,{signal})),sections=[];let count=0,nextSection=null;
 for(const node of descendants(fragment)){
  const key=attr(node,'data-observanda-part');if(!key?.startsWith('section:')||!researchId(key.slice(8))||!shown(node))continue;
  if(count++<sectionAfter)continue;if(sections.length===12){nextSection=sectionAfter+12;break;}
  const heading=[...descendants(node)].find(n=>/^h[1-6]$/.test(n.tagName)&&shown(n)),title=heading?excerpt(heading,''):'';
  sections.push({id:key.slice(8),title,preview:excerpt(node,title)});
 }
 const overview=projectedSourceOverview(fragment,source.title),metadata=projectedRecordMetadata(fragment),preview=excerpt(fragment,source.title);
 await checkLibraryStamp(store,stamp);
 return {id,revision,preview,overview,metadata,sections,nextSection,generation:stamp.generation,visibilityToken:stamp.visibilityToken};
}
