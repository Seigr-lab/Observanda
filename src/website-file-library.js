import {parseFragment} from 'parse5';
import {createHash,randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {attr,descendants} from './website-migration-views.js';

const root='.observanda/website-files',index=root+'/picker',generation=index+'/generation.json';
const views=new WeakMap(),validId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
const shardFile=id=>index+'/'+id.slice(0,2)+'.json';
const text=value=>value.normalize('NFKC').toLowerCase();
const scanLimit=4096,olderLimit=40;
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
  const fragment=parseFragment(html),metadata=[...descendants(fragment)].find(node=>attr(node,'data-observanda-part')==='metadata'&&shown(node));
  const time=metadata&&[...descendants(metadata)].find(node=>node.tagName==='time'&&shown(node));
  const value=time&&attr(time,'datetime');
  item=describe(source,excerpt(fragment,source.title),{...context,displayDate:typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(value)&&value.length<=40?value:null});
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
   const next=describe(source,prior?.preview,{...context,displayDate:prior?.displayDate});
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
function afterIndex(names,after){
 if(after===null)return 0;
 let lo=0,hi=names.length;
 while(lo<hi){const mid=Math.floor((lo+hi)/2);if(names[mid]<=after)lo=mid+1;else hi=mid;}
 return lo;
}
async function census(store,scope,epoch,signal){
 const vault=store.workspace.vault;
 let view=views.get(vault);
 if(!view||view.epoch!==epoch||view.root!==store.workspace.root){
  // The directory census has no entry content. Committed permission changes
  // invalidate it across processes.
  view={epoch,root:store.workspace.root,names:await ids(store,scope,signal)};views.set(vault,view);
 }
 return view;
}
async function visitWindow(store,names,at,stamp,{signal,needsScope,visit}){
 let visited=0,older=0,groups=0,group=null,metadata;
 for(;at<names.length&&visited<scanLimit&&older<olderLimit;at++,visited++){
  signal?.throwIfAborted();const id=names[at];if(stamp.pending.has(id))continue;
  if(group!==id.slice(0,2)){if(++groups>32)break;group=id.slice(0,2);metadata=await shard(store,id);}
  let item=metadata[id];
  if(item===undefined||needsScope&&item?.notebookId&&!Object.hasOwn(item,'projectId')){
   // Earlier workspaces have file descriptors without compact summaries.
   // Read only those descriptors, never a fragment or asset during search.
   older++;const source=await store.source(id,{pending:true});item=source?.visible&&source.target==='website'?describe(source,item?.revision===source.revision?item.preview:''):null;
  }
  if(!item)continue;
  if(item.id!==id||!validId(item.revision)||typeof item.title!=='string'||typeof item.media!=='boolean')throw new AppError('FORMAT');
  if(visit(item)===false){at++;break;}
 }
 return at;
}
export async function searchWebsiteLibrary(store,scope,{search='',filter='all',after=null,limit=20,projectId=null,notebookId=null,signal}={}){
 if(typeof search!=='string'||search.length>160||!['all','media','text'].includes(filter)||after!==null&&!validId(after)||!Number.isInteger(limit)||limit<1||limit>40||projectId!==null&&!researchId(projectId)||notebookId!==null&&!researchId(notebookId))throw new AppError('INVALID');
 const stamp=await libraryStamp(store),view=await census(store,scope,stamp.generation,signal),terms=text(search).trim().split(/\s+/u).filter(Boolean),items=[];
 const at=await visitWindow(store,view.names,afterIndex(view.names,after),stamp,{signal,needsScope:!!projectId||!!notebookId,visit(item){
  if(projectId&&projectId!==item.projectId||notebookId&&notebookId!==item.notebookId||filter!=='all'&&(filter==='media')!==item.media)return;
  const haystack=text([item.title,item.id,item.recordId,item.notebookId,item.projectTitle,item.notebookTitle].join(' '));
  if(terms.every(term=>haystack.includes(term)))items.push(item);
  return items.length<limit;
 }});
 await checkLibraryStamp(store,stamp);
 return {items,next:at<view.names.length?view.names[at-1]:null,generation:stamp.generation,visibilityToken:stamp.visibilityToken};
}
export async function websiteLibraryFacets(store,scope,{kind,projectId=null,search='',after=null,limit=24,signal}={}){
 if(!['book','project'].includes(kind)||projectId!==null&&!researchId(projectId)||typeof search!=='string'||search.length>160||!Number.isInteger(limit)||limit<1||limit>100||after!==null&&!researchId(after)&&!/^scan:\d+$/.test(after))throw new AppError('INVALID');
 const stamp=await libraryStamp(store),view=await census(store,scope,stamp.generation,signal);
 // Cache only owner choices while their exact grant generation and pending
 // fence set are current. No entry text is retained in this cache.
 if(view.facets?.token!==stamp.visibilityToken)view.facets={token:stamp.visibilityToken,at:0,count:0,project:new Map(),book:new Map()};
 const facets=view.facets;
 if(facets.at<view.names.length){
  facets.busy??=(async()=>{
   // Merge a complete window. Cancellation halfway through must not count
   // a project or book twice when the next request resumes.
   const window=[],at=await visitWindow(store,view.names,facets.at,stamp,{needsScope:true,signal,visit:item=>{window.push(item);}});
   for(const item of window){
    if(item.projectId)add(facets.project,item.projectId,item.projectTitle);
    if(item.notebookId)add(facets.book,item.notebookId,item.notebookTitle,{projectId:item.projectId??null,projectTitle:item.projectTitle??null});
   }
   facets.count+=window.length;facets.at=at;
  })().finally(()=>{facets.busy=null;});
  await facets.busy;
 }
 function add(map,id,title,extra={}){
  const prior=map.get(id);if(!prior||title&&!prior.title)map.set(id,{id,title:title??null,fallback:!title,...extra,count:prior?.count??0});
  map.get(id).count++;
 }
 await checkLibraryStamp(store,stamp);
 const result={items:[],next:null,generation:stamp.generation,visibilityToken:stamp.visibilityToken};
 if(facets.at<view.names.length)return {...result,next:'scan:'+facets.at};
 result.totalEntries=facets.count;
 const needle=text(search.trim()),cursor=after&&!after.startsWith('scan:')?after:null;
 for(const row of facets[kind].values()){
  if(cursor&&row.id<=cursor||kind==='book'&&projectId&&projectId!==row.projectId||!text([row.title,row.projectTitle,row.id].join(' ')).includes(needle))continue;
  const index=result.items.findIndex(item=>item.id>row.id);result.items.splice(index<0?result.items.length:index,0,row);
  if(result.items.length>limit){result.items.pop();result.next=true;}
 }
 if(result.next)result.next=result.items.at(-1).id;
 return result;
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
 await checkLibraryStamp(store,stamp);
 return {id,revision,preview:excerpt(fragment,source.title),sections,nextSection,generation:stamp.generation,visibilityToken:stamp.visibilityToken};
}
