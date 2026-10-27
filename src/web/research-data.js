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
import {STATUSES,recordLabel} from './record-types.js';
import {chartGraphic} from './dashboard-cards.js';
import {researchCardFields,researchCardItems} from './research-card-items.js';
import {t} from './i18n/index.js';
import {dashboardRecordClient} from './dashboard-record-client.js';
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
  const metadata={
   type:{label:p.id==='records'?'Record type':'Type',format:(v,{esc})=>esc(p.id==='records'?recordLabel(v):v)},
   occurredOn:{label:'Record date',format:(v,{esc})=>esc(recordDateLabel(v))},body:{label:p.id==='records'?'Summary':'Text'},
   status:{label:'Status',format:(v,{esc})=>esc(String(v??'').replace(/^./,c=>c.toUpperCase()))},
   share:{label:'Included in website'},figures:{label:'Figures'},
   createdAt:{label:'Created'},updatedAt:{label:'Last updated'},
   notebookId:{label:'Lab book',technical:false,format:(id,{esc,context,item})=>esc(item.owner?.notebookTitle??context.book.notebooks.find(n=>n.id===id)?.title??'Unavailable lab book')},
   projectId:{label:'Project',technical:false,format:(id,{esc,context,item})=>esc(item.owner?.projectTitle??context.book.projects.find(p=>p.id===id)?.title??'Unavailable project')},
   id:{label:'Reference ID',technical:true}
  };
  registry.register({group:structural?'Projects':'Lab books',icon:'records',fieldMetadata:metadata,
   fields:(p.defaultFields??[]).map(key=>({key,...metadata[key]})),...p,
   scoped:Boolean(p.scope),
   ...dashboardRecordClient(p.id,{records:p.id==='records',structure:!projection}),
   settings:p.scope?(c,options={},panel,loaded)=>[
    ...dashboardScopeSettings(c,options,panel),
    ...(p.scope!=='projects'?dashboardBookSettings(c,options,panel):[]),
    ...(p.scope==='research'?[dashboardRecordTypeChoices,
    {key:'status',label:'Status',compact:true,type:'select',choices:[{value:'all',label:'All statuses'},...STATUSES.map(s=>({value:s,label:s.replace(/^./,c=>c.toUpperCase())}))]},
    {key:'tag',label:'Tag',type:'text'}]:[])
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

 add({id:'records',label:'Recent records',actions:()=>[{name:'new-entry',label:'New record'},{name:'entries',label:'All records'}],scope:'research',directory:true,defaultFields:['type','occurredOn','status'],
  items:(c,loaded,options={})=>{
   return entries(c).map(e=>({key:dashboardRecordIdentity(e),owner:e.owner,title:e.title,subtitle:e.owner?.notebookTitle??c.book.notebooks.find(n=>n.id===e.notebookId)?.title,data:{...dashboardRecordData(e),type:e.template?.label??e.type},action:recordAction(e)}));
  }});
 add({id:'projects',label:'Projects',icon:'projects',scope:'projects',directory:true,actions:()=>[{name:'new-project',label:'New project'}],defaultFields:[],defaultView:'overview',
  views:[{id:'overview',label:'Lab books',render:({item,esc})=>`<div class="desk-notebooks">${item.data.notebooks.map(n=>`<button class="desk-button desk-link" ${notebookAttrs(n,esc)}>${esc(n.title)}</button>`).join('')}${item.data.notebookTotal>item.data.notebooks.length?`<button class="desk-button desk-link" data-action="open-project" data-id="${esc(item.data.id)}">${esc(t('dashboardChoices','allBooks'))}</button>`:''}</div>`}],
  items:(c,loaded,options={})=>c.book.projects.map(p=>({key:p.id,title:p.title,data:{...p,notebooks:notebookDirectory(c.book,p.id,{counts:c.notebookCounts})},action:{name:'open-project',id:p.id}}))});
 add({id:'notebooks',label:'Lab books',icon:'projects',scope:'notebooks',directory:true,defaultFields:[],
  items:(c,loaded,options={})=>notebookDirectory(c.book,null,{recursive:true,counts:c.notebookCounts}).map(n=>({key:n.id,title:n.title,subtitle:locationName(c.sourceBook??c.book,n.projectIds[0]),data:n,action:notebookAction(n)}))});
 add({id:'sections',label:'Record sections',scope:'research',defaultFields:['body'],items:c=>nested(c,'sections')});
 add({id:'contributors',label:'Contributor credits',icon:'contributors',scope:'research',defaultFields:['role'],items:c=>nested(c,'contributors')});
 add({id:'relations',label:'Research links',scope:'research',defaultFields:['type','target'],items:c=>nested(c,'relations')});
 add({id:'figures',label:'Figures',icon:'figures',scope:'research',defaultFields:[],views:[{id:'chart',label:'Chart',render:({item,esc})=>'<figure class="desk-figure">'+chartGraphic(item.data,esc)+'</figure>'}],defaultView:'chart',items:c=>nested(c,'figures')});
 for(const [id,label] of [['files','Recent files'],['media','Media collection']])add({id,label,icon:'media',scope:'research',defaultFields:['kind','caption'],views:[{id:'media',label:'Media',render:({item,esc,context})=>mediaHTML(item,esc,context)}],defaultView:'media',items:c=>nested(c,id)});
 add({id:'workspace',label:'Workspace information',icon:'projects',defaultFields:['title','description'],fieldMetadata:{entries:{label:t('labBookData','recordCount')}},items:c=>[{key:c.book.id,title:c.book.title,data:{...c.book,entries:c.notebookCounts?Object.values(c.notebookCounts).reduce((sum,count)=>sum+count,0):c.book.entries.length}}]});
}

export const registerProjectData=registry=>registerResearchData(registry,{section:'projects'});
export const registerLabBookData=registry=>registerResearchData(registry,{section:'lab-books'});
