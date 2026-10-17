// Effective menu rows preserve authored order followed by implicit destinations.
// Their derivative excludes page bodies and is retained with each checkpoint.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {WebsiteCollectionIndex} from './website-collection-index.js';
import {websiteBook} from './web/website-sites-model.js';
import {hasHomepage} from './web/website-layouts.js';
import {RecordPublicationIndex} from './record-publication-index.js';
import {publicationPresentationTarget} from './web/publication-presentation-target.js';
import {websiteRecordShare} from './web/website-selection.js';
import {revisionId} from './web/revision-model.js';
const invalid=()=>{throw new AppError('INVALID');},damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');},ordinal=n=>String(n).padStart(16,'0');
export const validWebsiteNavigationProjection=v=>v&&Object.keys(v).sort().join()==='count,root,signature,version'&&v.version===1&&revisionId(v.signature)&&Number.isSafeInteger(v.count)&&v.count>=0&&validTableRef(v.root)&&(v.root?.count??0)===v.count*2;
export class WebsiteEditorNavigation{
 constructor(document,value){if(!validWebsiteNavigationProjection(value))damaged();this.document=document;this.value=value;this.index=new RetainedTableIndex(document.blocks,{namespace:'index',allowSparseBranches:true});}
 async row(entry){if(!entry)return null;const node=await this.document.tree.node(entry.revision),row=node.value;if(node.type!=='inline'||!row||Object.keys(row).sort().join()!=='available,key,position,revision,stored,value'||typeof row.key!=='string'||!Number.isSafeInteger(row.position)||row.position<0||row.position>=this.value.count||row.value?.target!==row.key||typeof row.available!=='boolean'||typeof row.stored!=='boolean'||row.revision!==null&&!revisionId(row.revision)||!['key:'+row.key,'position:'+ordinal(row.position)].includes(entry.id))damaged();return row;}
 async item(key){return this.row(await this.index.find(this.value,'key:'+key));}
 async window({offset=0,limit=20,signal}={}){if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)invalid();const start=await this.index.rank(this.value,'position:'),rows=[];for(let i=offset;i<Math.min(this.value.count,offset+limit);i++){signal?.throwIfAborted();const entry=await this.index.entryAt(this.value,start+i);if(entry?.id!=='position:'+ordinal(i))damaged();rows.push(await this.row(entry));}return {rows,total:this.value.count,offset};}
 async *rows({signal}={}){for(let offset=0;offset<this.value.count;offset+=32)for(const row of (await this.window({offset,limit:32,signal})).rows)yield row;}
 async verify(store,snapshot,site,indexes,{signal}={}){
  const source=await WebsiteEditorNavigation.source(store,snapshot,this.document,site,indexes,{signal});if(source.signature!==this.value.signature)damaged();let count=0;
  for await(const row of source.rows()){
   if(row.position!==count++)damaged();const revision=digest(serialize({type:'inline',value:row}));
   for(const key of ['key:'+row.key,'position:'+ordinal(row.position)])if((await this.index.find(this.value,key))?.revision!==revision)damaged();
  }
  if(count!==this.value.count)damaged();for await(const entry of this.index.entries(this.value)){signal?.throwIfAborted();await this.row(entry);}
 }
 static async source(store,snapshot,document,site,indexes,{signal}={}){
  const pages=indexes?await WebsiteCollectionIndex.open(document,'pages',indexes.pages,{signal}):null,navigation=indexes?await WebsiteCollectionIndex.open(document,'navigation',indexes.navigation,{signal}):null;
  const pageCount=indexes?.pages.count??await document.tree.arrayLength(document.root,['document','pages']);
  const pageAt=async position=>({key:(await document.field(['document','pages',String(position),'id'],{signal})).value,label:(await document.field(['document','pages',String(position),'title'],{signal})).value,shared:(await document.field(['document','pages',String(position),'share'],{signal})).value});
  const pageByKey=async key=>{if(pages)return pages.item(key,{signal});for(let position=0;position<pageCount;position++){const row=await pageAt(position);if(row.key===key)return row;}return null;};
  const navigationHas=async key=>{if(navigation)return !!await navigation.item(key,{signal});for await(const item of document.items(['document','website','navigation'],{signal}))if((await document.tree.selected(item.value,['target'])).value===key)return true;return false;};
  const book=websiteBook({...snapshot.metadata,entries:[]},site),selection=site.selection??{includeProjects:[],records:[]},sharedProjects=new Set(book.projects.filter(p=>p.share).map(p=>p.id)),owners=new Map(book.notebooks.map(n=>[n.id,n.projectId])),counts=new Map(book.notebooks.map(n=>[n.id,0])),publication=new RecordPublicationIndex(store);
  if(snapshot.publicationIndex){
   for(const notebook of book.notebooks){if(!sharedProjects.has(notebook.projectId))continue;signal?.throwIfAborted();const all=selection.includeProjects.includes(notebook.projectId)||selection.defaultShare===true;let count=0;
    for(const shared of all?[false,true]:selection.defaultShare===false?[]:[true]){const key='book:'+notebook.id+':share:'+Number(shared)+':';count+=await publication.rank(snapshot.publicationIndex,key+'\uffff')-await publication.rank(snapshot.publicationIndex,key);}counts.set(notebook.id,count);
   }
   for(const choice of selection.records){signal?.throwIfAborted();if(choice.share===null)continue;const member=await store.member(snapshot,choice.id);if(!member)continue;const row=await publication.describe(member),projectId=owners.get(row.notebookId);if(!sharedProjects.has(projectId))continue;const before=selection.includeProjects.includes(projectId)?true:selection.defaultShare??row.share;counts.set(row.notebookId,(counts.get(row.notebookId)??0)+Number(choice.share)-Number(before));}
  }else for await(const member of store.members(snapshot,{signal})){const row=await publication.describe(member),projectId=owners.get(row.notebookId);if(sharedProjects.has(projectId)&&websiteRecordShare(selection,row,projectId))counts.set(row.notebookId,(counts.get(row.notebookId)??0)+1);}
  const notebooks=book.notebooks.map(notebook=>({target:'notebook:'+notebook.id,label:notebook.title,show:false,available:(counts.get(notebook.id)??0)>0}));
  const fixed=[...(hasHomepage(book)?[{target:'home',label:'Home',show:true,available:true}]:[]),...book.projects.map(p=>({target:'project:'+p.id,label:p.title,show:true,available:p.share})),...notebooks],byTarget=new Map(fixed.map(value=>[value.target,value]));
  const signature=indexes?digest(serialize({pages:indexes.pages.root,navigation:indexes.navigation.source,fixed,external:Array.isArray(site.document.website.researchSources)})):null;
  const target=async key=>{if(byTarget.has(key))return byTarget.get(key);if(!key.startsWith('page:'))return publicationPresentationTarget(site.document.website,key,{records:false})?{target:key,label:key,show:true,available:false}:null;const row=await pageByKey(key.slice(5));return row?{target:key,label:row.label,show:true,available:row.shared}:null;};
  async function* rows(){
   let position=0;const row=(target,stored)=>({key:target.target,position:position++,revision:stored?.revision??null,stored:!!stored,available:target.available,value:{target:target.target,label:stored?.value.label||target.label,show:stored?.value.show??target.show,parent:stored?.value.parent??null}});
   for await(const item of document.items(['document','website','navigation'],{signal})){const stored=await document.tree.read(item.value),destination=await target(stored.target);yield row(destination??{target:stored.target,label:stored.label||stored.target,show:true,available:false},{value:stored,revision:item.value});}
   for(const destination of fixed){signal?.throwIfAborted();if(!await navigationHas(destination.target))yield row(destination,null);}
   for(let position=0;position<pageCount;position++){signal?.throwIfAborted();const page=await pageAt(position),key='page:'+page.key;if(!await navigationHas(key))yield row({target:key,label:page.label,show:true,available:page.shared},null);}
  }
  return {signature,rows,target,async total(){let count=0;for await(const row of rows())count++;return count;}};
 }
 static async retain(store,snapshot,document,site,indexes,previous,{signal}={}){
  const source=await this.source(store,snapshot,document,site,indexes,{signal});if(!source.signature)invalid();
  if(previous?.signature===source.signature){if(!validWebsiteNavigationProjection(previous))damaged();return previous;}
  if(document.blocks.readOnly)return null;
  const value={version:1,signature:source.signature,count:0,root:null},index=new RetainedTableIndex(document.blocks,{namespace:'index',allowSparseBranches:true});let pending=0;
  for await(const row of source.rows()){const revision=await document.tree.retain(row);value.count++;value.root=await index.change(value.root,'key:'+row.key,revision);value.root=await index.change(value.root,'position:'+ordinal(row.position),revision);if(++pending===32){await index.flush(value.root);pending=0;}}
  await index.flush(value.root);if(!validWebsiteNavigationProjection(value))damaged();return value;

 }
}
