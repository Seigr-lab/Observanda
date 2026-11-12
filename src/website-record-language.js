import {readFile} from 'node:fs/promises';
import {parse} from 'parse5';
import {attr,descendants} from './website-migration-views.js';
import {LANGUAGES,resolveLanguage} from './web/i18n/runtime.js';
import {RECORD_TYPES,STATUSES} from './web/record-types.js';
import {RELATION_TYPES} from './web/record-model.js';
import {calendarDate} from './web/record-date.js';
import {projectedDate} from './website-file-library-fields.js';
import {figureVariantKey,figureVariants,figureLanguageKey} from './website-figure-variants.js';

// Words around placed lab book material are site content: they follow the
// page's own language, never the language of the private application. Only
// renderer labels and recognised record values are rewritten; authored text,
// titles and template labels are never translated.
// Lab book profile text (section, field and record type names) is read from
// the labBookProfiles catalogue once the catalogue registry lists it.
const read=async(language,name)=>JSON.parse(await readFile(new URL('./web/locales/'+language+'/'+name+'.json',import.meta.url),'utf8'));
const registry=await read('.','catalogues');
const owned=['websiteRecordText','analyses','publication','recordEditors','recordDates','recordViews','online','retainedTables','book','measurements','labBookProfiles'].filter(name=>Object.hasOwn(registry,name));
const catalogues=new Map(await Promise.all(LANGUAGES.map(async({id})=>[id,Object.fromEntries(await Promise.all(owned.filter(name=>registry[name].includes(id)).map(async name=>[name,await read(id,name)])))])));
// Records keep a profile's canonical English text. Text that still equals a
// shipped default is shown in the page language; edited text stays as written.
const profileKeys=new Map();
for(const [key,value] of Object.entries(catalogues.get('en').labBookProfiles??{}))if(typeof value==='string'&&!profileKeys.has(value))profileKeys.set(value,key);
const labelled=new Set(['websiteRecordText','analyses','publication','retainedTables','book','measurements']);
const types=new Set(RECORD_TYPES.map(type=>type.id));
const valueKey='data-observanda-value';
const escapeText=value=>String(value).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const escapeAttribute=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const textOnly=node=>(node.childNodes??[]).every(child=>child.nodeName==='#text');
const ownText=node=>(node.childNodes??[]).map(child=>child.value??'').join('').trim();
const fill=(template,values)=>template.replace(/\{(\w+)\}/g,(whole,key)=>Object.hasOwn(values,key)?values[key]:whole);

export function recordMessages(language){
 const id=resolveLanguage(language),own=catalogues.get(id),english=catalogues.get('en');
 return (catalogue,key)=>{const value=own[catalogue]?.[key]??english[catalogue]?.[key];return typeof value==='string'?value:null;};
}
// A day the reader sees in full words, fixed to the calendar date itself.
export function readableDay(value,language){
 return new Intl.DateTimeFormat(resolveLanguage(language),{dateStyle:'long',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
}
// Keep exact days numeric inside labels, so any supported language can read
// the label back (src/website-file-library-fields.js) after a language change.
export function recordDateText(declared,message){
 if(!declared)return null;
 const dates=(key,values)=>message('recordDates',key)&&fill(message('recordDates',key),values);
 if(declared.kind==='unknown')return dates('unknown',{});
 const label=declared.kind==='day'?declared.value:declared.kind==='range'?dates('range',{from:declared.from,to:declared.to}):
  declared.kind==='month'?dates('month',{month:message('recordDates','month'+Number(declared.value.slice(5))),year:declared.value.slice(0,4)}):dates('year',{year:declared.value});
 return declared.estimated?dates('estimated',{date:label}):label;
}
function termText(kind,value,message){
 if(kind==='type')return types.has(value)?message('recordEditors','type_'+value+'_label'):termText('profile',value,message);
 if(kind==='profile')return profileKeys.has(value)?message('labBookProfiles',profileKeys.get(value)):null;
 if(kind==='status')return STATUSES.includes(value)?message('recordViews','statusValues.'+value.replaceAll(' ','-')):null;
 if(kind==='relation'){const index=RELATION_TYPES.indexOf(value);return index<0?null:message('online','linkType'+index);}
 return null;
}

// Rewrites one saved page. Called for every page file written or rendered by
// the website file store, so placements, displays, feeds and source updates
// all show the same words in the page's language.
export function localizedRecordPage(html){
 if(typeof html!=='string'||!html.includes('data-observanda-')&&!html.includes('data-feed-field'))return html;
 const tree=parse(html,{sourceCodeLocationInfo:true}),root=[...descendants(tree)].find(node=>node.tagName==='html');
 const language=attr(root??{},'lang')??'en',message=recordMessages(language),changes=[];
 function setText(node,text,raw,key=valueKey){
  const loc=node.sourceCodeLocation;if(!text||!loc?.startTag||!loc.endTag||!textOnly(node))return;
  if(ownText(node)!==text)changes.push({start:loc.startTag.endOffset,end:loc.endTag.startOffset,text:escapeText(text)});
  if(raw!==undefined&&attr(node,key)===undefined)changes.push({start:loc.startTag.endOffset-1,end:loc.startTag.endOffset-1,text:' '+key+'="'+escapeAttribute(raw)+'"'});
 }
 function setAttribute(node,name,value){
  const loc=node.sourceCodeLocation?.attrs?.[name];
  if(value&&loc&&attr(node,name)!==value)changes.push({start:loc.startOffset,end:loc.endOffset,text:name+'="'+escapeAttribute(value)+'"'});
 }
 function term(node,kind){
  const raw=attr(node,valueKey)??ownText(node),text=termText(kind,raw,message);
  if(text)setText(node,text,raw);
 }
 function date(node){
  if(node.tagName==='time'&&calendarDate(attr(node,'datetime'))){setText(node,readableDay(attr(node,'datetime'),language));return;}
  const raw=attr(node,valueKey),value=raw??ownText(node);
  // A time element keeps the exact day machine-readable in its datetime.
  if(calendarDate(value)){setText(node,readableDay(value,language),value,node.tagName==='time'&&raw===undefined?'datetime':valueKey);return;}
  setText(node,recordDateText(projectedDate(value),message));
 }
 function metadata(node){
  const children=(node.childNodes??[]).filter(child=>child.tagName);
  const first=children[0],last=children.at(-1);
  if(first?.tagName==='span'&&attr(first,'class')!=='record-date')term(first,'type');
  if(last&&last!==first&&last.tagName==='span'&&attr(last,'class')!=='record-date')term(last,'status');
  for(const child of children)if(child.tagName==='time'||child.tagName==='span'&&attr(child,'class')==='record-date')date(child);
 }
 function visit(node,inside){
  inside||=attr(node,'data-observanda-source')!==undefined||attr(node,'data-website-feed')!==undefined;
  if(inside&&node.tagName){
   const label=attr(node,'data-observanda-label'),[catalogue,key]=label?.split(':')??[];
   if(labelled.has(catalogue)&&key)setText(node,message(catalogue,key));
   // A message with values: numbers are written in the page's locale.
   const format=attr(node,'data-observanda-format'),[formatCatalogue,formatKey]=format?.split(':')??[];
   if(labelled.has(formatCatalogue)&&formatKey){
    let values=null;try{values=JSON.parse(attr(node,'data-observanda-args')??'{}');}catch{values=null;}
    const template=message(formatCatalogue,formatKey),numbers=new Intl.NumberFormat(resolveLanguage(language));
    if(template&&values&&typeof values==='object'&&!Array.isArray(values))setText(node,fill(template,Object.fromEntries(Object.entries(values).map(([name,value])=>[name,typeof value==='number'?numbers.format(value):String(value)]))));
   }
   const named=attr(node,'data-observanda-term');if(named==='date')date(node);else if(named)term(node,named);
   // Accessible names of focusable regions, such as a scrolling data table.
   const aria=attr(node,'data-observanda-aria'),[ariaCatalogue,ariaKey]=aria?.split(':')??[];
   // A named region keeps its own name, such as a figure title, after the label.
   const ariaSuffix=attr(node,'data-observanda-aria-suffix');
   if(labelled.has(ariaCatalogue)&&ariaKey)setAttribute(node,'aria-label',message(ariaCatalogue,ariaKey)+(ariaSuffix?' '+ariaSuffix:''));
   const part=attr(node,'data-observanda-part');
   if(part==='metadata')metadata(node);
   if(part==='contributors'&&node.tagName==='ul')setAttribute(node,'aria-label',message('websiteRecordText','contributors'));
   if(part==='tags'&&node.tagName==='ul')setAttribute(node,'aria-label',message('websiteRecordText','tags'));
   // A plotted figure shows the drawing made for the page's language.
   if(node.tagName==='img'&&attr(node,figureVariantKey)!==undefined){
    const variants=figureVariants(attr(node,figureVariantKey)),chosen=variants.get(resolveLanguage(language))??variants.get('en');
    if(chosen)setAttribute(node,'src',chosen);
   }
   // Inline panel drawings: only the page language's drawing is shown.
   const drawing=attr(node,figureLanguageKey);
   if(drawing!==undefined){
    const page=resolveLanguage(language),siblings=(node.parentNode?.childNodes??[]).filter(child=>attr(child,figureLanguageKey)!==undefined);
    const served=child=>attr(child,figureLanguageKey).split(/\s+/).includes(page);
    const shown=siblings.some(served)?served(node):attr(node,figureLanguageKey).split(/\s+/).includes('en');
    const loc=node.sourceCodeLocation,hiddenAt=loc?.attrs?.hidden;
    if(shown&&hiddenAt)changes.push({start:hiddenAt.startOffset-1,end:hiddenAt.endOffset,text:''});
    if(!shown&&!hiddenAt&&loc?.startTag)changes.push({start:loc.startTag.endOffset-1,end:loc.startTag.endOffset-1,text:' hidden'});
   }
   const field=attr(node,'data-feed-field');
   if(field==='type')term(node,'type');
   if(field==='date')date(node);
  }
  if(node.tagName!=='template')for(const child of node.childNodes??[])visit(child,inside);
 }
 visit(tree,false);
 if(!changes.length)return html;
 return changes.sort((a,b)=>b.start-a.start||b.end-a.end).reduce((text,change)=>text.slice(0,change.start)+change.text+text.slice(change.end),html);
}
