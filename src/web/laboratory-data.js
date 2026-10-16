import {registerLabWorkspaceData} from './laboratory/workspace-data.js';
import {validateSamplePage} from './sample-analysis-pages.js';
import {t} from './i18n/index.js';
import {sampleAnalysisAction} from './sample-analysis-labels.js';
const tr=key=>t('sampleAnalysis',key);
export function registerLaboratoryData(registry){
 registerLabWorkspaceData(registry);
 for(const definition of [
  {id:'samples',view:'samples',defaultFields:['code','material','receivedOn'],title:s=>s.code},
  {id:'analyses',view:'all',defaultFields:['status','sampleCode','updatedAt'],title:s=>s.code},
  {id:'lab-events',view:'events',defaultFields:['at','actor','reason'],title:s=>sampleAnalysisAction(s.action)}
 ]){
  const query=async(api,context,values,signal)=>{
   const command={workspaceId:context.book.id,view:definition.view,...values};
   return validateSamplePage(await api('/api/laboratory/read/query',command,{adopt:false,signal}),command);
  };
  registry.register({...definition,label:tr(definition.id==='lab-events'?'events':definition.id),group:tr('title'),icon:'laboratory',pageSize:100,
   loadKey:(c)=>JSON.stringify([c.book.id,c.etag,c.recordLimit,c.recordKey,c.recordCursor]),
   load:({api,context,signal})=>query(api,context,{limit:context.recordLimit??7,key:context.recordKey??null,cursor:context.recordCursor??null},signal),
   discover:async({api,context,search,offset,limit,signal})=>{
    const result=await query(api,context,{search,offset,limit},signal);
    return {...result,items:result.items.map(item=>({key:item.id,title:definition.title(item)||tr(definition.view==='events'?'events':definition.id)}))};
   },
   items:(context,result)=>result.items.map(item=>({key:item.id,title:definition.title(item)||tr(definition.view==='events'?'events':definition.id),data:item,action:{name:'laboratory-samples'}}))
  });
 }
 registry.register({id:'laboratory',label:tr('overview'),group:tr('title'),icon:'laboratory',
  load:async({api,context,signal})=>{
   const command={workspaceId:context.book.id,view:'samples',limit:1};return validateSamplePage(await api('/api/laboratory/read/query',command,{adopt:false,signal}),command);
  },loadKey:context=>JSON.stringify([context.book.id,context.etag]),defaultFields:['samples','inReview','approved'],fieldMetadata:{samples:{label:tr('samples')},inReview:{label:tr('inReview')},approved:{label:tr('approvedCount')}},
  items:(context,result)=>[{key:context.book.id,title:tr('title'),data:{samples:result.counts.samples,inReview:result.counts.review,approved:result.counts.approved},action:{name:'laboratory-samples'}}]
 });
}
