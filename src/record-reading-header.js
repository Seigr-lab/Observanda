// The reader's growing header collections are separate counted windows. Values
// needed by visible prose are resolved by identity, independently of those windows.
import {placedFigures} from './web/book-selectors.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {AppError} from './errors.js';
import {recordAttemptWindow} from './record-attempt-window.js';
import {resultDocumentWindow,resultFigureCount} from './record-result-document.js';
import {figureTargets} from './web/figure-composition.js';
const attemptCollections=['preparations','events','assessments'];
export const recordHeaderCollections=['contributors','relations','figures','attachments','tags','fields','results',...attemptCollections];
export const validHeaderWindows=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([name,offset])=>recordHeaderCollections.includes(name)&&Number.isSafeInteger(offset)&&offset>=0);
export async function recordReadingHeader(store,row,document,sections,{windows={},anchor,resultFigure,signal}={}){
 const header={},pages={},inline={figures:[],attachments:[]},contextRelations=[],membership=new RecordMemberCollections(store);
 const selected=async path=>(await document.field(path,{signal})).value;
 const position=async(name,id)=>{
  if(row.collections||Array.isArray(row.cardItems?.[name]))return membership.position(row,name,id);
  for await(const ref of document.items([name],{signal}))if((await document.tree.selected(ref.value,['id'])).value===id)return ref.index;
  return -1;
 };
 for(const name of await document.tree.propertyNames(document.root)){
  signal?.throwIfAborted();
  if(['sections','template','attempt',...recordHeaderCollections].includes(name))continue;
  header[name]=await selected([name]);
 }
 if(header.id!==row.id||header.notebookId!==row.notebookId)throw new AppError('CATALOGUE_DAMAGED');
 const page=async(name,path)=>{
  const total=await document.tree.arrayLength(document.root,path),offset=Math.min(windows[name]??0,Math.max(0,total-1));
  return document.tree.page(document.root,path,{offset,limit:4});
 };
 // An unplaced figure anchor can name a late collection item directly. A prose
 // placement is resolved below and remains beside its original paragraph.
 const anchored=anchor?.startsWith('record-figure-')?anchor.slice('record-figure-'.length):null;
 for(const name of recordHeaderCollections.filter(name=>!['fields','results'].includes(name)&&!attemptCollections.includes(name))){
  signal?.throwIfAborted();
  if(anchored&&['figures','attachments'].includes(name)){
   const found=await position(name,anchored);if(found>=0)windows={...windows,[name]:found};
  }
  const result=await page(name,[name]);header[name]=result.values;pages[name]={offset:result.offset,total:result.total,count:result.values.length};
  if(name==='tags')pages[name].revision=await document.reference(['tags'],{signal});
 }
 const template=await document.tree.select(document.root,['template']);
 if(template){
  const node=template.inline?{type:'inline',value:template.value}:await document.tree.node(template.revision);
  if(node.type==='inline'&&node.value===null)header.template=null;
  else{
   const result=await page('fields',['template','fields']),value={};
   for(const name of ['id','profileId','label','description'])value[name]=await selected(['template',name]);
   value.fields=result.values;value.values={};
   for(const definition of result.values){const stored=await document.field(['template','values',definition.key],{signal});if(stored.found)value.values[definition.key]=stored.value;}
   header.template=value;pages.fields={offset:result.offset,total:result.total,count:result.values.length};
  }
 }
 const visible=placedFigures({...header,sections});
 for(const id of visible)for(const name of ['figures','attachments']){
  signal?.throwIfAborted();if(header[name].some(item=>item.id===id))continue;
  const found=await position(name,id);if(found<0)continue;
  const item=await selected([name,String(found)]);if(item?.id!==id)throw new AppError('CATALOGUE_DAMAGED');
  inline[name].push(item);
 }
 // Workflow context is one parent. It must not disappear merely because the
 // relationship's display row is outside the selected links window.
 if(row.runOf?.length&&!header.relations.some(item=>item.role==='run-of'))for await(const ref of document.items(['relations'],{signal})){
  if((await document.tree.selected(ref.value,['role'])).value==='run-of'){contextRelations.push(await document.tree.read(ref.value));break;}
 }
 const run=await recordAttemptWindow(document,{windows,signal});if(run.attempt)header.attempt=run.attempt;Object.assign(pages,run.pages);
 const results=await resultDocumentWindow(document,{offset:windows.results??0,figureId:resultFigure??null,anchor,signal});
 if(results.results)header.results=results.results;pages.results=results.page;
 const resultFigures={};
 for(const {id} of figureTargets([...header.figures,...inline.figures]))resultFigures[id]=await resultFigureCount(document,id,{signal});
 return {header,collections:pages,inline,contextRelations,attemptWindow:run.window,resultWindow:{figureId:results.figureId},resultFigures};
}
