import {bindReadingTables} from './record-reading-tables.js';
import {recordHeaderControls} from './record-header-controls.js';
import {readingMaterialReference} from './record-reading-reference.js';
import {resultStatementsView} from './result-statements.js';
import {figureResultLinks,resultStatementAnchor} from './figure-result-links.js';
import {attemptView} from './attempt-view.js';
import {recordRevisionView,recordRevisionField} from './record-revision-view.js';
import {researchReference} from './research-reference.js';
import {t} from './i18n/index.js';
import {applyRichTextStyles} from './rich-text-stylesheet.js';
import {proseDocument} from './prose-model.js';

export const READING_PAGE_SIZE=5;
const text=(key,args)=>t('recordReading',key,args);

const contentText=(key,args)=>t('recordContent',key,args);
const selectedRecord=value=>value.readingProjection?{...value.header,sections:value.sections.values}:value;
export function styleReadingRecords(records,doc){
 for(const value of records){const record=selectedRecord(value);for(const body of [record.body,...record.sections.map(s=>s.body),...Object.values(record.template?.values??{}).filter(v=>v?.type==='doc')])applyRichTextStyles(doc,proseDocument(body));}
}

// Every card stays on the query's immutable snapshot. Its independent windows
// are reading projections, never editable records or whole-record selections.
export async function readBookWindow(api,command,{signal,onCommand=()=>{}}={}){
 let pending={...command};
 for(;;){
  onCommand(pending);const result=await api('/api/workspace/read/record-content',pending,{adopt:false,signal});signal?.throwIfAborted();
  if(result?.workspaceId!==command.workspaceId||result.recordId!==command.recordId||result.etag!==command.snapshotId)throw Error(text('incomplete'));
  if(result.search){
   if(typeof result.search.nextCursor!=='string'||!result.search.nextCursor||result.search.nextCursor===pending.cursor)throw Error(text('incomplete'));
   pending={...pending,cursor:result.search.nextCursor};continue;
  }
  const sections=result.sections;
  if(result.header?.id!==command.recordId||!sections||![sections.offset,sections.total].every(n=>Number.isSafeInteger(n)&&n>=0)||!Array.isArray(sections.values)||sections.values.length>4||sections.offset+sections.values.length>sections.total||!result.collections)throw Error(text('incomplete'));
  for(const page of Object.values(result.collections))if(!page||![page.offset,page.count,page.total].every(n=>Number.isSafeInteger(n)&&n>=0)||page.count>4||page.offset+page.count>page.total)throw Error(text('incomplete'));
  return {...result,readingProjection:true};
 }
}
export async function readBookPage({state,api,page,signal}){
 const ids=page.records.map(r=>r.id);if(!ids.length)return [];
 if(state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21){
  const records=[];for(const recordId of ids)records.push(await readBookWindow(api,{workspaceId:page.workspaceId,recordId,snapshotId:page.snapshotId,offset:0,pagedHeader:true},{signal}));return records;
 }
 if(state.etag!==page.snapshotId)throw Error(text('changed'));
 const byId=new Map(state.book.entries.map(r=>[r.id,r]));if(ids.some(id=>!byId.has(id)))throw Error(text('incomplete'));return ids.map(id=>byId.get(id));
}
const windowButton=(key,action,esc,disabled=false,attributes='')=>'<button type="button" class="button" data-action="record-list-content-'+action+'" '+attributes+(disabled?' disabled':'')+'>'+esc(contentText(key))+'</button>';
function sectionControls(page,esc,busy){
 if(page.total<=4)return '';
 return '<nav class="record-section-navigation" data-record-collection="sections" aria-label="'+esc(contentText('navigation'))+'"><span role="status">'+esc(contentText('range',{first:page.offset+1,last:page.offset+page.values.length,total:page.total}))+'</span><div class="inline-actions">'+windowButton('previous','previous',esc,busy||page.offset===0,'data-collection="sections"')+windowButton('next','next',esc,busy||page.offset+page.values.length>=page.total,'data-collection="sections"')+'</div><label>'+esc(contentText('goTo'))+' <input type="number" data-collection-position="sections" min="1" max="'+page.total+'" value="'+(page.offset+1)+'" required></label>'+windowButton('go','go',esc,busy,'data-collection="sections"')+'</nav>';
}
export function bookReadingEntry(value,esc,options={}){
 const record=selectedRecord(value),busy=!!value.loading,assetUrl=options.assetUrl,fieldsHtml={},reference=ref=>readingMaterialReference(ref,esc,{workspaceId:value.workspaceId??options.workspaceId});
 const controls=name=>recordHeaderControls(name,value.collections?.[name],esc,busy).replaceAll('data-action="content-','data-action="record-list-content-');
 const links=record.relations.map(link=>'<li><span>'+esc(link.type)+'</span> <a href="'+esc(researchReference(link.target))+'">'+esc(link.label||text('linkedRecord'))+'</a>'+(link.target.revision?' <small>'+esc(text('exactRevision',{revision:link.target.revision.slice(0,12)}))+'</small>':'')+'</li>').join('');
 let selectedOptions={};
 if(value.readingProjection){
  const inlineRecord={...record,figures:[...record.figures,...value.inline?.figures??[]],attachments:[...record.attachments,...value.inline?.attachments??[]]},figureResults=figure=>figureResultLinks(figure,value.resultFigures,esc,{action:'record-list-content-results-figure'});
  for(const name of Object.keys(value.collections))if(!name.startsWith('preparation:')&&!['relations','preparations','events','assessments','results'].includes(name)){
   const key=name==='fields'?'template':name;fieldsHtml[key]=value.collections[name].total?controls(name)+recordRevisionField(key,record,esc,{assetUrl,figureResults}):'';
  }
  fieldsHtml.attempt=attemptView(record.attempt,esc,{reference,window:value.attemptWindow,navigation:controls});
  fieldsHtml.results=(value.resultWindow?.figureId?'<p>'+esc(contentText('resultsForFigure'))+'</p>'+windowButton('allResults','results-all',esc,busy):'')+controls('results')+resultStatementsView(record.results,esc,{reference});
  selectedOptions={inlineRecord,fieldsHtml,figureResults,attemptWindow:value.attemptWindow,sectionsHtml:figure=>sectionControls(value.sections,esc,busy)+recordRevisionField('sections',record,esc,{anchors:true,figure})};
 }
 const status=(value.error?'<p role="alert">'+esc(value.error)+'</p>'+windowButton('retry','retry',esc,busy):'')+(busy?'<p role="status">'+esc(contentText('loading'))+'</p>'+windowButton('cancel','cancel',esc):'');
 return '<section class="lab-book-reading-entry" data-reading-record="'+esc(record.id)+'" aria-busy="'+busy+'"><header><h2>'+esc(record.title)+'</h2><div class="inline-actions"><button class="button" data-action="browse-record" data-id="'+esc(record.id)+'">'+esc(text('details'))+'</button><button class="button" data-action="edit-entry" data-id="'+esc(record.id)+'">'+esc(text('edit'))+'</button></div></header>'+status+recordRevisionView(record,esc,{...options,attemptReference:reference,resultReference:reference,relations:false,anchors:true,...selectedOptions})+((links||value.collections?.relations.total)?'<nav aria-label="'+esc(text('researchLinks'))+'"><h3>'+esc(text('researchLinks'))+'</h3>'+(value.readingProjection?controls('relations'):'')+'<ul>'+links+'</ul></nav>':'')+'</section>';
}
export function bookReadingView(records,esc,options={}){return '<div class="lab-book-reading">'+records.map(record=>bookReadingEntry(record,esc,options)).join('')+'</div>';}

// Paging mutates only the owning card. Inactive cards, input focus and the
// enclosing record list keep their existing DOM and pinned navigation state.
export function bookReadingWindows({api,esc,records,active,decorate,assetUrl,workspaceId}){
 const requests=new Map(),node=id=>document.querySelector('[data-reading-record="'+id+'"]');
 const valid=item=>active()&&records().includes(item);
 const stop=()=>{for(const [item,request] of requests){request.abort();item.loading=false;item.error=contentText('cancelled');}requests.clear();};
 function paint(item){
  if(!valid(item))return;const root=node(item.recordId);if(!root)return;
  root.outerHTML=bookReadingEntry(item,esc,{assetUrl,workspaceId});const next=node(item.recordId);scopeReadingAnchors(next);decorate(next.parentElement);styleReadingRecords([item],document);
 }
 async function load(item,command,{focus=null,anchor=null}={}){
  requests.get(item)?.abort();const request=new AbortController();requests.set(item,request);item.loading=true;item.error=null;paint(item);
  try{
   const value=await readBookWindow(api,command,{signal:request.signal,onCommand:pending=>{item.pending={command:pending,focus,anchor};}});
   if(!valid(item)||requests.get(item)!==request)return;
   Object.assign(item,value);delete item.pending;item.loading=false;paint(item);
   const root=node(item.recordId),target=anchor?root.querySelector('[id="reading-'+item.recordId+'-'+anchor+'"]'):focus==='sections'?root.querySelector('.prose section[id]'):focus?root.querySelector('[data-record-collection="'+focus+'"] input')??root.querySelector('.result-statements>section')??root.querySelector('h2'):null;
   if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});}
   else if(anchor){item.error=text('incomplete');paint(item);}
  }catch(error){if(valid(item)&&requests.get(item)===request&&!request.signal.aborted){item.loading=false;item.error=error.message??contentText('failed');paint(item);}}
  finally{if(requests.get(item)===request)requests.delete(item);}
 }
 function command(item,extra={}){return {workspaceId:item.workspaceId,recordId:item.recordId,snapshotId:item.etag,offset:item.sections.offset,pagedHeader:true,windows:Object.fromEntries(Object.entries(item.collections).map(([name,page])=>[name,page.offset])),...(item.resultWindow?.figureId?{resultFigure:item.resultWindow.figureId}:{}),...extra};}
 async function action(control){
  const name=control.dataset.action;if(!name?.startsWith('record-list-content-'))return false;
  const item=records().find(value=>value.readingProjection&&value.recordId===control.closest('[data-reading-record]')?.dataset.readingRecord);if(!item)return true;
  const operation=name.slice('record-list-content-'.length).replace(/^collection-/,'');
  if(operation==='cancel'){requests.get(item)?.abort();requests.delete(item);item.loading=false;item.error=contentText('cancelled');paint(item);return true;}
  if(item.loading)return true;
  if(operation==='retry'){if(item.pending)await load(item,item.pending.command,item.pending);return true;}
  if(['results-figure','results-all'].includes(operation)){
   const next=command(item);next.windows.results=0;if(operation==='results-figure')next.resultFigure=control.dataset.resultFigure;else delete next.resultFigure;
   await load(item,next,{focus:'results'});return true;
  }
  const collection=control.dataset.collection,page=collection==='sections'?item.sections:item.collections[collection];if(!page)return true;
  let offset=page.offset+(operation==='previous'?-4:4);
  if(operation==='go'){const input=node(item.recordId).querySelector('[data-collection-position="'+collection+'"]');if(!input.reportValidity())return true;offset=Number(input.value)-1;}
  const next=command(item);if(collection==='sections')next.offset=Math.max(0,offset);else next.windows[collection]=Math.max(0,offset);
  await load(item,next,{focus:collection});return true;
 }
 function anchors(event){
  const link=event.target.closest('.lab-book-reading a[href^="#"]'),root=link?.closest('[data-reading-record]'),item=root&&records().find(value=>value.readingProjection&&value.recordId===root.dataset.readingRecord);if(!item)return;
  const href=link.getAttribute('href').slice(1),anchor=href.replace('reading-'+item.recordId+'-','');
  if(document.getElementById(href)||! /^(?:(?:record-)?result-|record-(?:section|figure|table|equation|citation|block)-)[a-f0-9-]{36}$/.test(anchor))return;
  event.preventDefault();event.stopPropagation();if(item.loading)return;
  const next=command(item,{anchor});if(resultStatementAnchor(anchor))delete next.resultFigure;
  void load(item,next,{anchor:resultStatementAnchor(anchor)??anchor});
 }
 return {stop,action,bind(root){root?.addEventListener('click',anchors);}};
}

// Copied rich text can contain matching block IDs in independent records.
// Keep native in-record anchors local to each rendered record on this page.
export function scopeReadingAnchors(root){
 bindReadingTables(root);
 for(const record of root.matches('[data-reading-record]')?[root]:root.querySelectorAll('[data-reading-record]')){
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
