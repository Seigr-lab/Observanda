import {recordTypeLabel} from './record-type-presentation.js';
import './i18n/catalogues/dashboardEditors.js';
import './i18n/catalogues/labBookData.js';
import {dashboardRecordIdentity,dashboardRecordAction,dashboardRecordData} from './dashboard-collection-client.js';
import {ownedAssetURL} from './project-context.js';
import {recentRecordOrder} from './query-order.js';
import {recordDateLabel} from './record-date.js';
import {dashboardScopeSettings,dashboardBookSettings} from './dashboard-scope.js';
import {dashboardRecordTypeChoices} from './dashboard-record-type-choices.js';
import {locationName} from './workspace-structure.js';
import {notebookDirectory} from './laboratory/notebook-model.js';
import {queryPanel} from './dashboard-queries.js';
import {defaultPanelConfig} from './dashboard-model.js';
import {STATUSES} from './record-types.js';
import {chartGraphic} from './dashboard-cards.js';
import {researchCardFields,researchCardItems} from './research-card-items.js';
import {t} from './i18n/index.js';
import {dashboardRecordClient} from './dashboard-record-client.js';
const dt=(key,parameters)=>t('dashboardEditors',key,parameters);

const notebookAction=n=>({name:n.route.action,data:Object.fromEntries(Object.entries(n.route).filter(([k])=>k!=='action'))});
const notebookAttrs=(n,esc)=>Object.entries(n.route).map(([key,value])=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+'="'+esc(value)+'"').join(' ');
const recordAction=dashboardRecordAction;
const entries=c=>c.book.entries.slice().sort(recentRecordOrder);
const nested=(c,provider)=>entries(c).flatMap(e=>researchCardItems(provider,e));
const mediaHTML=(item,esc,context)=>{
 const a=item.data,url=esc(ownedAssetURL(item.owner?{projectOwner:item.owner}:context,'/api/media/'+encodeURIComponent(a.id)));
 return a.kind==='image'?`<img class="desk-source-image" loading="lazy" src="${url}" alt="${esc(a.alt||a.caption||'')}">`:['audio','video'].includes(a.kind)?`<${a.kind} class="desk-source-image" controls preload="none" src="${url}"></${a.kind}>`:'';
};
export function registerResearchData(registry,{section='all'}={}){

 const add=p=>{
  const structural=['projects','workspace'].includes(p.id);if(section==='projects'&&!structural||section==='lab-books'&&structural)return;
  const rawItems=p.items,projection=p.id==='records'||Object.hasOwn(researchCardFields,p.id);
  const metadata=()=>({
   ...Object.fromEntries(['title','description','kind','caption','role','target'].map(key=>[key,{label:dt(key)}])),
   type:{label:p.id==='records'?dt("recordType"):dt("type"),format:(v,{esc,item})=>esc(p.id==='records'&&!item?.data.template?.label?recordTypeLabel(v):v)},
   occurredOn:{label:dt("recordDate"),format:(v,{esc})=>esc(recordDateLabel(v))},body:{label:p.id==='records'?dt("summary"):dt("text")},
   status:{label:dt("status"),format:(v,{esc})=>esc(STATUSES.includes(v)?t('recordValues','status_'+v):String(v??''))},
   share:{label:dt("includedInWebsite")},figures:{label:dt("figures")},
   createdAt:{label:dt("created")},updatedAt:{label:dt("updated")},
   notebookId:{label:dt("labBook"),technical:false,format:(id,{esc,context,item})=>esc(item.owner?.notebookTitle??context.book.notebooks.find(n=>n.id===id)?.title??dt("unavailableBook"))},
   projectId:{label:dt("project"),technical:false,format:(id,{esc,context,item})=>esc(item.owner?.projectTitle??context.book.projects.find(p=>p.id===id)?.title??dt("unavailableProject"))},
   id:{label:dt("referenceId"),technical:true}
  });
  const presentation=()=>{const fields={...metadata(),...(p.id==='workspace'?{entries:{label:t('labBookData','recordCount')}}:p.fieldMetadata)};return {
   label:dt(({records:'recentRecords',projects:'projects',notebooks:'labBooks',sections:'recordSections',contributors:'contributorCredits',relations:'researchLinks',figures:'figures',files:'recentFiles',media:'mediaCollection',workspace:'workspaceInformation'})[p.id]),
   group:structural?dt('projects'):dt('labBooks'),fieldMetadata:fields,fields:(p.defaultFields??[]).map(key=>({key,...fields[key]})),
   views:p.views?.map(v=>({...v,label:dt(({overview:'labBooks',chart:'chart',media:'media'})[v.id])}))};};
  registry.register({icon:'records',...p,...presentation(),presentation,
   scoped:Boolean(p.scope),
   ...dashboardRecordClient(p.id,{records:p.id==='records',structure:!projection}),
   settings:p.scope?(c,options={},panel,loaded)=>[
    ...dashboardScopeSettings(c,options,panel),
    ...(p.scope!=='projects'?dashboardBookSettings(c,options,panel):[]),
    ...(p.scope==='research'?[dashboardRecordTypeChoices,
    {key:'status',label:dt("status"),compact:true,type:'select',choices:[{value:'all',label:dt("allStatuses")},...STATUSES.map(s=>({value:s,label:t('recordValues','status_'+s)}))]},
    {key:'tag',label:dt("tag"),type:'text'}]:[])
   ]:undefined,
   items:(context,loaded,options={})=>{
    if(context.outline&&projection&&p.id!=='records')return loaded?.items??[];
    if(loaded?.collection&&!projection)return loaded.items;
    if(loaded?.collection)return rawItems({...context,book:{...context.book,entries:loaded.records??[]}},loaded,options);
    if(!p.scope)return rawItems(context,loaded,options);
    const config={...defaultPanelConfig(),...context.legacyConfig,...options};
    const scope=queryPanel(context.book,{config,options});if(scope.unavailable)throw new Error(scope.unavailable);
    return rawItems({...context,sourceBook:context.book,book:{...context.book,entries:loaded?.records??scope.entries,projects:scope.projects,notebooks:scope.notebooks}},loaded,options);
   }
  });
 };

 add({id:'records',label:dt("recentRecords"),actions:()=>[{name:'new-entry',label:dt("newRecord")},{name:'entries',label:dt("allRecords")}],scope:'research',directory:true,defaultFields:['type','occurredOn','status'],
  items:(c,loaded,options={})=>{
   return entries(c).map(e=>({key:dashboardRecordIdentity(e),owner:e.owner,title:e.title,subtitle:e.owner?.notebookTitle??c.book.notebooks.find(n=>n.id===e.notebookId)?.title,data:{...dashboardRecordData(e),type:e.template?.label??e.type},action:recordAction(e)}));
  }});
 add({id:'projects',label:dt("projects"),icon:'projects',scope:'projects',directory:true,actions:()=>[{name:'new-project',label:dt("newProject")}],defaultFields:[],defaultView:'overview',
  views:[{id:'overview',label:dt("labBooks"),render:({item,esc})=>`<div class="desk-notebooks">${item.data.notebooks.map(n=>`<button class="desk-button desk-link" ${notebookAttrs(n,esc)}>${esc(n.title)}</button>`).join('')}${item.data.notebookTotal>item.data.notebooks.length?`<button class="desk-button desk-link" data-action="open-project" data-id="${esc(item.data.id)}">${esc(t('dashboardChoices','allBooks'))}</button>`:''}</div>`}],
  items:(c,loaded,options={})=>c.book.projects.map(p=>({key:p.id,title:p.title,data:{...p,notebooks:notebookDirectory(c.book,p.id,{counts:c.notebookCounts})},action:{name:'open-project',id:p.id}}))});
 add({id:'notebooks',label:dt("labBooks"),icon:'projects',scope:'notebooks',directory:true,defaultFields:[],
  items:(c,loaded,options={})=>notebookDirectory(c.book,null,{recursive:true,counts:c.notebookCounts}).map(n=>({key:n.id,title:n.title,subtitle:locationName(c.sourceBook??c.book,n.projectIds[0]),data:n,action:notebookAction(n)}))});
 add({id:'sections',label:dt("recordSections"),scope:'research',defaultFields:['body'],items:c=>nested(c,'sections')});
 add({id:'contributors',label:dt("contributorCredits"),icon:'contributors',scope:'research',defaultFields:['role'],items:c=>nested(c,'contributors')});
 add({id:'relations',label:dt("researchLinks"),scope:'research',defaultFields:['type','target'],items:c=>nested(c,'relations')});
 add({id:'figures',label:dt("figures"),icon:'figures',scope:'research',defaultFields:[],views:[{id:'chart',label:dt("chart"),render:({item,esc})=>'<figure class="desk-figure">'+chartGraphic(item.data,esc)+'</figure>'}],defaultView:'chart',items:c=>nested(c,'figures')});
 for(const [id,label] of [['files',dt("recentFiles")],['media',dt("mediaCollection")]])add({id,label,icon:'media',scope:'research',defaultFields:['kind','caption'],views:[{id:'media',label:dt("media"),render:({item,esc,context})=>mediaHTML(item,esc,context)}],defaultView:'media',items:c=>nested(c,id)});
 add({id:'workspace',label:dt("workspaceInformation"),icon:'projects',defaultFields:['title','description'],fieldMetadata:{entries:{label:t('labBookData','recordCount')}},items:c=>[{key:c.book.id,title:c.book.title,data:{...c.book,entries:c.notebookCounts?Object.values(c.notebookCounts).reduce((sum,count)=>sum+count,0):c.book.entries.length}}]});
}

export const registerProjectData=registry=>registerResearchData(registry,{section:'projects'});
export const registerLabBookData=registry=>registerResearchData(registry,{section:'lab-books'});
