// Source permissions bound every website and edition choice. Originals remain
// intact for authenticated reading and revision recovery.
import {publicationPartAllowed} from './record-publication-privacy.js';
// Existing version-one records without part overrides have the same projection.
// A new override invalidates all dependent projections in its record write.
export const SOURCE_PUBLICATION_VERSION=1;
export const sourceNotebookAllowed=(book,target='website')=>!!book&&(target==='website'?book.share!==false:target==='pdf'&&book.sharePdf===true);
export const sourceRecordAllowed=(record,metadata,target='website')=>(target==='website'?record.share===true:target==='pdf'&&record.sharePdf===true)&&(!metadata||metadata.notebooks.some(book=>book.id===record.notebookId&&sourceNotebookAllowed(book,target)));
export const publicRecordSections=(record,target='website')=>(record.sections??[]).filter(section=>target==='website'?section.share!==false:target==='pdf'&&section.sharePdf===true);
// Public credit for a photograph or recording on a website: creator, credit
// line and licence only. Capture date and time, subject, location and archive
// reference stay in the lab book; PDF output receives no media details.
export function publicMediaAttribution(metadata){
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))return null;
 const value=(key,max)=>typeof metadata[key]==='string'?metadata[key].trim().slice(0,max):'';
 const attribution={creator:value('creator',300),credit:value('credit',600),licence:value('licence',300)};
 return Object.values(attribution).some(Boolean)?attribution:null;
}
export const publicRecordAttachments=(record,target='website')=>(record.attachments??[]).filter(item=>target==='website'?item.share===true:target==='pdf'&&item.sharePdf===true).map(({metadata,...item})=>{
 const attribution=target==='website'?publicMediaAttribution(metadata):null;
 return attribution?{...item,attribution}:item;
});
export function sourcePublicationRecord(record,target='website',retainedTargets=[]){
 const result={...record,sections:publicRecordSections(record,target),attachments:publicRecordAttachments(record,target)};
 for(const key of ['body','outcome'])if(!publicationPartAllowed(record,key,target))result[key]='';
 for(const key of ['contributors','tags','figures','relations'])if(!publicationPartAllowed(record,key,target))result[key]=[];
 for(const key of ['results','attempt','template'])if(!publicationPartAllowed(record,key,target))delete result[key];
 // A field marked never to publish (personal data, precise locations) leaves
 // every output with its value, whatever the record's other choices.
 if(result.template?.fields?.some(field=>field.private===true)){
  const fields=result.template.fields.filter(field=>field.private!==true),kept=new Set(fields.map(field=>field.key));
  result.template={...result.template,fields,values:Object.fromEntries(Object.entries(result.template.values??{}).filter(([key])=>kept.has(key)))};
 }
 const hidden=new Set(record.publication?.[target]?.hiddenFigures);
 if(hidden.size&&result.figures)result.figures=result.figures.filter(figure=>!hidden.has(figure.id));
 // Prose alternatives and captions may themselves contain withheld content.
 // Strip the entire reference before website, PDF or search rendering.
 let shown;
 function permittedProse(node){
  if(!node||typeof node!=='object')return node;
  if(node.type==='book_figure'){
   shown??=new Set([...(result.figures??[]),...result.attachments].map(item=>item.id));
   return shown.has(node.attrs.figureId)?node:null;
  }
  if(!node.content)return node;
  const content=node.content.map(permittedProse);if(!content.some((child,i)=>child!==node.content[i]))return node;
  const kept=content.filter(Boolean);
  if(!kept.length&&node.type==='blockquote')return null;
  if(!kept.length&&node.type==='doc')kept.push({type:'paragraph',content:[]});
  return {...node,content:kept};
 }
 if(result.body&&typeof result.body==='object')result.body=permittedProse(result.body);
 result.sections=result.sections.map(section=>typeof section.body==='object'?{...section,body:permittedProse(section.body)}:section);
 if((hidden.size||!publicationPartAllowed(record,'figures',target))&&result.results?.statements?.some(item=>item.kind==='figure')){
  const plots=new Set((result.figures??[]).flatMap(f=>[f.id,...(f.kind==='panels'?f.panels.map(p=>p.figure.id):[])]));
  for(const id of retainedTargets)plots.add(id);
  result.results={...result.results,statements:result.results.statements.filter(item=>item.kind!=='figure'||plots.has(item.figureId))};
 }
 // Consent and withheld values never become website content or public metadata.
 delete result.publication;return result;
}
