import {recordSelectionReader} from './record-selection-reader.js';
import {recordRevisionView} from './record-revision-view.js';
import {researchReference} from './research-reference.js';
import {t} from './i18n/index.js';
import {applyRichTextStyles} from './rich-text-stylesheet.js';
import {proseDocument} from './prose-model.js';

export const READING_PAGE_SIZE=5;
const text=(key,args)=>t('recordReading',key,args);

export function styleReadingRecords(records,doc){
 for(const record of records)for(const value of [record.body,...record.sections.map(s=>s.body),...Object.values(record.template?.values??{}).filter(v=>v?.type==='doc')])applyRichTextStyles(doc,proseDocument(value));
}

// Read a bounded page from the same snapshot as the index. Reading does not
// adopt these records into the editable workspace or create a draft.
export async function readBookPage({state,api,page,signal}){
 const ids=page.records.map(r=>r.id);
 if(!ids.length)return [];
 let records;
 if(state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21){
  const reader=recordSelectionReader((url,body,options)=>api(url,body,{...options,adopt:false}),{workspaceId:page.workspaceId,ids,snapshotId:page.snapshotId});
  const data=await reader.read({signal});records=data.book.entries;
 }else{
  if(state.etag!==page.snapshotId)throw Error(text('changed'));
  records=state.book.entries;
 }
 const byId=new Map(records.map(r=>[r.id,r]));
 if(ids.some(id=>!byId.has(id)))throw Error(text('incomplete'));
 return ids.map(id=>byId.get(id));
}

export function bookReadingView(records,esc,options={}){
 return `<div class="lab-book-reading">${records.map(record=>{
  const links=record.relations.map(link=>`<li><span>${esc(link.type)}</span> <a href="${esc(researchReference(link.target))}">${esc(link.label||text('linkedRecord'))}</a>${link.target.revision?` <small>${esc(text('exactRevision',{revision:link.target.revision.slice(0,12)}))}</small>`:''}</li>`).join('');
  return `<section class="lab-book-reading-entry" data-reading-record="${esc(record.id)}"><header><h2>${esc(record.title)}</h2><div class="inline-actions"><button class="button" data-action="browse-record" data-id="${esc(record.id)}">${esc(text('details'))}</button><button class="button" data-action="edit-entry" data-id="${esc(record.id)}">${esc(text('edit'))}</button></div></header>${recordRevisionView(record,esc,{...options,relations:false,anchors:true})}${links?`<nav aria-label="${esc(text('researchLinks'))}"><h3>${esc(text('researchLinks'))}</h3><ul>${links}</ul></nav>`:''}</section>`;
 }).join('')}</div>`;
}

// Copied rich text can contain matching block IDs in independent records.
// Keep native in-record anchors local to each rendered record on this page.
export function scopeReadingAnchors(root){
 for(const record of root.querySelectorAll('[data-reading-record]')){
  const prefix='reading-'+record.dataset.readingRecord+'-',ids=new Set();
  for(const el of record.querySelectorAll('[id]')){if(el.id.startsWith(prefix))continue;ids.add(el.id);el.id=prefix+el.id;}
  // SVG clipping, masks and accessibility references use the same IDs as
  // native section anchors. Renaming only their targets disables clipping or
  // accidentally binds a copied figure to another record's geometry.
  for(const el of record.querySelectorAll('*')){
   for(const name of ['href','xlink:href']){
    const value=el.getAttribute(name);if(value?.startsWith('#')&&ids.has(value.slice(1)))el.setAttribute(name,'#'+prefix+value.slice(1));
   }
   for(const name of ['clip-path','mask','filter','fill','stroke','marker-start','marker-mid','marker-end']){
    const value=el.getAttribute(name);if(value)el.setAttribute(name,value.replace(/url\(\s*(['"]?)#([^\s)'"]+)\1\s*\)/g,(match,quote,id)=>ids.has(id)?'url(#'+prefix+id+')':match));
   }
   for(const name of ['aria-labelledby','aria-describedby']){
    const value=el.getAttribute(name);if(value)el.setAttribute(name,value.split(/\s+/).map(id=>ids.has(id)?prefix+id:id).join(' '));
   }
  }
 }
}
