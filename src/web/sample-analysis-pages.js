import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {t} from './i18n/index.js';
const text=value=>typeof value==='string';
const time=value=>text(value)&&Number.isFinite(Date.parse(value));
export function validSampleRow(row,view,{summary=false}={}){
 if(!researchId(row?.id))return false;
 if(view==='samples')return ['code','material','source','collectedOn','receivedOn'].every(k=>text(row[k]))&&(summary||Number.isSafeInteger(row.analyses)&&row.analyses>=0);
 if(view==='events')return ['action','actor','reason'].every(k=>text(row[k]))&&time(row.at)&&researchId(row.recordId);
 const r=row.result;
 return text(row.code)&&researchId(row.sampleId)&&text(row.sampleCode)&&['draft','in review','approved','rejected','archived'].includes(row.status)&&time(row.updatedAt)&&r&&['method','analyte','unit'].every(k=>text(r[k]))&&['numeric','text'].includes(r.kind)&&(r.kind==='numeric'?typeof r.value==='number'&&Number.isFinite(r.value):text(r.value))&&[r.lower,r.upper].every(v=>v===null||typeof v==='number'&&Number.isFinite(v));
}
export function validateSamplePage(page,{workspaceId,view,limit}){
 if(!page||page.workspaceId!==workspaceId||page.view!==view||!(page.etag==='new'||revisionId(page.etag))||!Array.isArray(page.items)||page.items.length>limit||page.items.some(item=>!validSampleRow(item,view))||new Set(page.items.map(item=>item.id)).size!==page.items.length||
  !Number.isSafeInteger(page.total)||page.total<0||!Number.isSafeInteger(page.offset)||page.offset<0||page.offset+page.items.length>page.total||page.items.length!==Math.min(limit,page.total-page.offset)||
  !['cursor','previousCursor','nextCursor'].every(k=>k!=='cursor'&&page[k]===null||typeof page[k]==='string'&&page[k].length>0&&page[k].length<=1024)||
  (page.offset>0)!==(page.previousCursor!==null)||(page.offset+page.items.length<page.total)!==(page.nextCursor!==null)||!page.counts||!['samples','analyses','review','archive','approved','events'].every(k=>Number.isSafeInteger(page.counts[k])&&page.counts[k]>=0))throw Error(t('sampleAnalysis','invalidPage'));
 return page;
}
// One page per visible surface; failed navigation keeps the previous page.
export function sampleAnalysisPages({api,context,onChange}){
 let page=null,error=null,loading=false,controller=null,generation=0,request=null,stopped=false;
 async function load(query){
  controller?.abort();const attempt=++generation,scope=context();controller=new AbortController();request=query;loading=true;error=null;onChange();
  try{
   const result=await api('/api/laboratory/read/query',query,{adopt:false,signal:controller.signal});
   if(stopped||attempt!==generation||scope!==context())return false;
   page=validateSamplePage(result,query);return true;
  }catch(e){if(!stopped&&attempt===generation&&scope===context()&&e.name!=='AbortError')error=e;return false;}
  finally{if(!stopped&&attempt===generation&&scope===context()){loading=false;onChange();}}
 }
 function clear(){generation++;controller?.abort();page=null;error=null;loading=false;request=null;}
 return {load,retry:()=>request?load(request):Promise.resolve(false),clear,stop(){clear();stopped=true;},get page(){return page;},get error(){return error;},get loading(){return loading;},get request(){return request;}};
}
