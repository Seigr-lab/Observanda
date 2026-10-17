import {randomUUID} from 'node:crypto';
import {WebsiteEditor} from '../src/website-editor.js';
import {WebsiteSites} from '../src/website-sites.js';
import {WEBSITE_DOCUMENT_FIELDS} from '../src/web/website-sites-model.js';
import {websiteCollectionKey} from '../src/web/website-collection-model.js';
import {openPublicationInput} from '../src/publication-input-reader.js';
import {contentBuffer} from '../src/file-content.js';
import {readPublicationRecord} from '../src/publication-input.js';
import {selectEditionRecord} from '../src/web/publication-selection.js';
export async function publicationText(candidate){let text='';for await(const [name,content] of candidate.files)if(/\.(html|css|csv|svg|json)$/.test(name))text+=(await contentBuffer(content)).toString('utf8');return text;}
export async function publicationInputBook(workspace,source){
 if(source.version===6){
  const input=await openPublicationInput(workspace,source),metadata=await input.metadata(),entries=[];
  for await(const row of input.records({order:'original'}))entries.push(await input.record(row.id));
  for(const name of ['projects','notebooks','pages','branding'])metadata[name]=await Array.fromAsync(input.items(name,{shared:false}));
  for(const name of ['navigation','assets','layouts'])metadata.website[name]=await Array.fromAsync(input.items(name));
  metadata.website.presentation.covers=await Array.fromAsync(input.items('covers'));metadata.website.presentation.media=await Array.fromAsync(input.items('presentationMedia'));
  for(let index=0;index<metadata.pages.length;index++)if(metadata.pages[index].share)metadata.pages[index]=await input.page(metadata.pages[index].id);
  return {...metadata,entries};
 }
 const entries=[];for(const row of source.records)entries.push(selectEditionRecord(await readPublicationRecord(workspace,source,row),row.selection));return {...source.metadata,entries};}

// Native publication selects saved research and an independently retained
// website draft. Synthetic full books are only fixture input, never API commands.
export async function publicationDraftCommand(workspace,book){
 const current=await workspace.read(),research={...structuredClone(book),revision:current.book.revision,createdAt:current.book.createdAt};
 for(const key of [...WEBSITE_DOCUMENT_FIELDS,'websites']){if(Object.hasOwn(current.book,key))research[key]=structuredClone(current.book[key]);else delete research[key];}
 const saved=await workspace.save(research,current.etag);book.entries=structuredClone(saved.book.entries);
 const existing=(await new WebsiteSites(workspace).read(null)).site.document,editor=new WebsiteEditor(workspace),base={workspaceId:book.id,websiteId:null};let state=await editor.execute('open',base);
 const operations=[{type:'settings',path:['projects'],value:book.projects.map(({id,share,logoId})=>({id,share,logoId}))},{type:'settings',path:['selection'],value:{defaultShare:false,includeProjects:[],records:book.entries.map(record=>({id:record.id,share:record.share,attachments:record.attachments.map(({id,share})=>({id,share}))}))}}];
 for(const [key,value] of Object.entries(book.website))if(!['navigation','assets','layouts'].includes(key))operations.push({type:'settings',path:['document','website',key],value});
 for(const key of ['appearance','themes','activeThemeId'])operations.push({type:'settings',path:['document',key],value:book[key]});
 for(const [collection,values] of Object.entries({pages:book.pages,branding:book.branding,navigation:book.website.navigation,assets:book.website.assets,layouts:book.website.layouts}))for(const value of values){
  const key=websiteCollectionKey(collection,value),saved=existing[collection]??existing.website[collection];
  operations.push(['pages','assets'].includes(collection)&&!saved.some(item=>websiteCollectionKey(collection,item)===key)?{type:'append',collection,values:[value]}:{type:'replace',collection,key,value});
 }
 for(let offset=0;offset<operations.length;offset+=32)state=await editor.execute('change',{...base,websitePin:state.websitePin,draftId:state.draft?.id??null,expectedRevision:state.draft?.revision??null,commandId:randomUUID(),operations:operations.slice(offset,offset+32)});
 return {etag:state.websitePin.researchSnapshotId,websitePin:state.websitePin,websiteDraft:{id:state.draft.id,revision:state.draft.revision}};
}
