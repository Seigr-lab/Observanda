// Bounded presentation windows over the current authoring draft. These are
// labels and references, never independently editable record originals.
export const MEDIA_WINDOW=12,PROJECT_WINDOW=5,CONTENT_WINDOW=10;
export function inventoryWindow(source,{offset=0,limit=MEDIA_WINDOW,query='',label=item=>item.label}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1)throw new TypeError('Invalid inventory window');
 offset=Math.floor(offset/limit)*limit;
 const needle=query.trim().toLocaleLowerCase();let total=0,items=[],tail=[];
 for(const item of source){
  if(needle&&!label(item).toLocaleLowerCase().includes(needle))continue;
  if(total%limit===0)tail=[];tail.push(item);
  if(total>=offset&&total<offset+limit)items.push(item);total++;
 }
 if(offset>=total){offset=total?Math.floor((total-1)/limit)*limit:0;items=tail;}
 return {items,total,offset,previous:offset?Math.max(0,offset-limit):null,next:offset+items.length<total?offset+limit:null};
}
export function* websiteMediaItems(book,{research=false,kind='all'}={}){
 const item=(asset,entry=null)=>({key:entry?entry.id+':'+asset.id:asset.id,label:[entry?.title,asset.caption||asset.alt||asset.name||asset.kind].filter(Boolean).join(' / '),asset,entryId:entry?.id??null});
 if(research){for(const entry of book.entries)for(const asset of entry.attachments)if(kind==='all'||kind==='media'&&asset.kind!=='file'||asset.kind===kind)yield item(asset,entry);}
 else for(const asset of book.website.assets)if(kind==='all'||kind==='media'&&asset.kind!=='file'||asset.kind===kind)yield item(asset);
}
export function websiteMediaItem(book,key,{research=false}={}){
 if(!research){const asset=book.website.assets.find(a=>a.id===key);return asset?{key,label:asset.caption||asset.alt||asset.name||asset.kind,asset,entryId:null}:null;}
 const [entryId,id]=key.split(':'),entry=book.entries.find(e=>e.id===entryId),asset=entry?.attachments.find(a=>a.id===id);
 return asset?{key,label:entry.title+' / '+(asset.caption||asset.alt||asset.name||asset.kind),asset,entryId}:null;
}
export function* websiteSectionLists(book){
 yield book.website.home.sections;
 for(const page of book.pages)yield page.sections??[];
 for(const layout of book.website.layouts)yield layout.sections;
 for(const template of book.website.templates)yield template.sections;
 for(const region of book.website.design.regions?.definitions??[])yield region.sections;
}
export function websiteAssetUsed(book,id){
 for(const sections of websiteSectionLists(book))for(const section of sections)if(section.assetId===id||section.assetIds?.includes(id))return true;
 return false;
}
export function contentProjects(book,search=''){
 const needle=search.trim().toLocaleLowerCase(),notebooks=new Map(book.notebooks.map(n=>[n.id,n.projectId])),counts=new Map();
 for(const record of book.entries){const projectId=notebooks.get(record.notebookId);if(!projectId)continue;
  const value=counts.get(projectId)??{total:0,included:0,matches:false};value.total++;if(record.share)value.included++;if(needle&&record.title.toLocaleLowerCase().includes(needle))value.matches=true;counts.set(projectId,value);
 }
 return (function*(){for(const project of book.projects){const value=counts.get(project.id)??{total:0,included:0,matches:false};
  if(!needle||value.matches||project.title.toLocaleLowerCase().includes(needle))yield {project,...value};
 }})();
}
export function* contentRecords(book,project,search=''){
 const ids=new Set(book.notebooks.filter(n=>n.projectId===project.id).map(n=>n.id)),needle=search.trim().toLocaleLowerCase(),all=!needle||project.title.toLocaleLowerCase().includes(needle);
 for(const record of book.entries)if(ids.has(record.notebookId)&&(all||record.title.toLocaleLowerCase().includes(needle)))yield record;
}
