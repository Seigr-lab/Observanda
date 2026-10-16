import {registerLabWorkspaceData} from './laboratory/workspace-data.js';
import {validateSamplePage} from './sample-analysis-pages.js';
import {dashboardCollection} from './dashboard-collection-client.js';
import {dashboardScopeSettings,dashboardBookSettings} from './dashboard-scope.js';
import {sampleCollectionQuery,sampleCollectionAction} from './sample-analysis-collection.js';
import {t} from './i18n/index.js';
import {sampleAnalysisAction} from './sample-analysis-labels.js';
const tr=key=>t('sampleAnalysis',key);
export function registerLaboratoryData(registry){
 registerLabWorkspaceData(registry);
 for(const definition of [
  {id:'samples',view:'samples',defaultFields:['owner','code','material','receivedOn'],title:s=>s.code},
  {id:'analyses',view:'all',defaultFields:['owner','status','sampleCode','updatedAt'],title:s=>s.code},
  {id:'lab-events',view:'events',defaultFields:['owner','at','actor','reason'],title:s=>sampleAnalysisAction(s.action)}
 ]){
  const query=async(api,context,values,signal)=>{
   const command={workspaceId:context.book.id,view:definition.view,...values};
   return validateSamplePage(await api('/api/laboratory/read/query',command,{adopt:false,signal}),command);
  };
  registry.register({...definition,label:tr(definition.id==='lab-events'?'events':definition.id),group:tr('title'),icon:'laboratory',pageSize:25,scoped:true,metadataOnly:true,settings:(c,options,panel)=>dashboardCollection(c)?[...dashboardScopeSettings(c,options,panel),...dashboardBookSettings(c,options,panel)]:[],
   fieldMetadata:{owner:{label:tr('owner')}},
   loadKey:(c,options)=>JSON.stringify([c.book.id,c.etag,c.legacyConfig,options,c.recordLimit,c.recordKey,c.recordCursor]),
   load:({api,context,options={},signal})=>dashboardCollection(context)?sampleCollectionQuery(api,context,definition.view,options,{},signal):query(api,context,{limit:context.recordLimit??7,key:context.recordKey??null,cursor:context.recordCursor??null},signal),
   discover:async({api,context,search,offset,limit,signal})=>{
    const result=dashboardCollection(context)?await sampleCollectionQuery(api,context,definition.view,{search},{mode:'discovery',offset,limit,key:null,cursor:null},signal):await query(api,context,{search,offset,limit},signal);
    return {...result,items:result.items.map(item=>({key:item.collectionKey??item.id,title:definition.title(item)||tr(definition.view==='events'?'events':definition.id)}))};
   },
   items:(context,result)=>result.items.map(item=>({key:item.collectionKey??item.id,title:definition.title(item)||tr(definition.view==='events'?'events':definition.id),data:{...item,owner:item.owner?[item.owner.projectTitle,item.owner.notebookTitle].filter(Boolean).join(' / '):context.book.title},action:item.owner?sampleCollectionAction(item,definition.view):{name:'laboratory-samples'}}))
  });
 }
 registry.register({id:'laboratory',label:tr('overview'),group:tr('title'),icon:'laboratory',scoped:true,metadataOnly:true,settings:(c,options,panel)=>dashboardCollection(c)?[...dashboardScopeSettings(c,options,panel),...dashboardBookSettings(c,options,panel)]:[],
  load:async({api,context,options={},signal})=>{
   if(dashboardCollection(context))return sampleCollectionQuery(api,context,'samples',options,{mode:'counts',limit:1,key:null,cursor:null},signal);
   const command={workspaceId:context.book.id,view:'samples',limit:1};return validateSamplePage(await api('/api/laboratory/read/query',command,{adopt:false,signal}),command);
  },loadKey:(context,options)=>JSON.stringify([context.book.id,context.etag,context.legacyConfig,options]),defaultFields:['samples','inReview','approved'],fieldMetadata:{samples:{label:tr('samples')},inReview:{label:tr('inReview')},approved:{label:tr('approvedCount')}},
  items:(context,result)=>[{key:context.book.id,title:tr('title'),data:{samples:result.counts.samples,inReview:result.counts.review,approved:result.counts.approved},...(dashboardCollection(context)?{}:{action:{name:'laboratory-samples'}})}]
 });
}
