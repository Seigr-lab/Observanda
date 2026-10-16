import {RECORD_TYPES,STATUSES} from './record-types.js';
// Shared, versioned presentation contracts. No research, secrets or file paths belong here.
export const defaultPanelConfig = () => ({title:'',workspaceId:null,projectId:null,notebookId:null,recordType:'all',status:'all',tag:''});
const legacyModule=tool=>['projects','workspace'].includes(tool)?'projects':['laboratory','samples','analyses','lab-events'].includes(tool)?'laboratory':['website','pages'].includes(tool)?'publishing':['records','projects','notebooks','media','files','figures','contributors','sections','relations','workspace'].includes(tool)?'research':null;
export const createPanel = (tool,id,width='standard') => ({id,tool,moduleId:legacyModule(tool),width,height:0,column:null,hidden:false,source:null,fields:null,presentation:tool==='projects'?'overview':tool==='figures'?'chart':['media','files'].includes(tool)?'media':'summary',options:{},count:6,config:defaultPanelConfig()});
export const defaultShortcuts=()=>['records','projects','figures','contributors'].map(tool=>({id:tool,moduleId:legacyModule(tool),source:{provider:tool,key:null},workspaceId:null}));
export const defaultDashboard=()=>({formatVersion:5,enabledModules:['publishing'],defaultId:'main',shortcuts:defaultShortcuts(),views:[{id:'main',name:'Dashboard',panels:[createPanel('records','recent','wide'),createPanel('projects','collections')]}]});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,fields)=>object(v)&&Object.keys(v).length===fields.length&&fields.every(f=>Object.hasOwn(v,f));
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f]/.test(v);
const unique=values=>new Set(values).size===values.length;
export function validPanelConfig(c){
 return keys(c,['title','workspaceId','projectId','notebookId','recordType','status','tag'])&&
  text(c.title,96)&&text(c.tag,40)&&[c.workspaceId,c.projectId,c.notebookId].every(value=>value===null||uuid(value))&&
  (!(c.projectId||c.notebookId)||Boolean(c.workspaceId))&&(!c.notebookId||Boolean(c.projectId))&&
  (c.recordType==='all'||RECORD_TYPES.some(t=>t.id===c.recordType)||typeof c.recordType==='string'&&c.recordType.startsWith('template:')&&uuid(c.recordType.slice(9)))&&(c.status==='all'||STATUSES.includes(c.status));
}
function validVersion(v,version){
 if(!keys(v,['formatVersion','defaultId','enabledTools','views'])||v.formatVersion!==version||!id(v.defaultId)||!Array.isArray(v.enabledTools)||v.enabledTools.length>64||!v.enabledTools.every(id)||!unique(v.enabledTools)||!Array.isArray(v.views)||v.views.length<1||v.views.length>20)return false;
 if(!unique(v.views.map(view=>view?.id))||!v.views.some(view=>view?.id===v.defaultId))return false;
 return v.views.every(view=>keys(view,['id','name','panels'])&&id(view.id)&&text(view.name,80)&&view.name.trim().length>0&&Array.isArray(view.panels)&&view.panels.length<=32&&unique(view.panels.map(p=>p?.id))&&view.panels.every(p=>keys(p,['id','tool','width','count',...(version>=2?['config']:[]),...(version>=3?['height']:[])])&&id(p.id)&&id(p.tool)&&(version>=3?['quarter','standard','half','wide','full']:['standard','wide','full']).includes(p.width)&&Number.isInteger(p.count)&&p.count>=1&&p.count<=20&&(version<2||validPanelConfig(p.config))&&(version<3||Number.isInteger(p.height)&&(p.height===0||p.height>=240&&p.height<=1200))));
}
const validScopeOptions=v=>Object.entries(v).every(([key,value])=>{
 if(['projectIds','notebookIds','resourceIds'].includes(key))return Array.isArray(value)&&value.every(uuid);
 if(['scopeMode','notebookMode','resourceMode'].includes(key))return ['all','selected'].includes(value);
 if(['includeWorkspace','includeDescendants'].includes(key))return typeof value==='boolean';
 return true;
});
const validOptions=(v,version)=>object(v)&&(version<5||validScopeOptions(v))&&Object.entries(v).every(([key,value])=>id(key)&&(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||text(value,512)||version>=5&&Array.isArray(value)&&value.length<=4096&&value.every(item=>text(item,256))&&unique(value)));
const validSource=s=>keys(s,['provider','key'])&&id(s.provider)&&(s.key===null||text(s.key,512));
const validShortcut=s=>keys(s,['id','moduleId','source','workspaceId'])&&id(s.id)&&(s.moduleId===null||id(s.moduleId))&&validSource(s.source)&&(s.workspaceId===null||uuid(s.workspaceId));
export function validDashboard(v){
 if(!keys(v,['formatVersion','enabledModules','defaultId','shortcuts','views'])||!Array.isArray(v.enabledModules)||!v.enabledModules.every(id)||!unique(v.enabledModules)||!Array.isArray(v.shortcuts)||!v.shortcuts.every(validShortcut)||!unique(v.shortcuts.map(s=>s.id))||![4,5].includes(v.formatVersion)||!id(v.defaultId)||!Array.isArray(v.views)||!v.views.length||!unique(v.views.map(view=>view?.id))||!v.views.some(view=>view?.id===v.defaultId))return false;
 return v.views.every(view=>keys(view,['id','name','panels'])&&id(view.id)&&text(view.name,80)&&view.name.trim()&&Array.isArray(view.panels)&&unique(view.panels.map(p=>p?.id))&&view.panels.every(p=>
  keys(p,['id','tool','moduleId','width','height','column','hidden','source','fields','presentation','options','count','config'])&&id(p.id)&&id(p.tool)&&(p.moduleId===null||id(p.moduleId))&&
  (['quarter','standard','half','wide','full'].includes(p.width)||Number.isInteger(p.width)&&p.width>=3&&p.width<=12)&&
  Number.isSafeInteger(p.height)&&p.height>=0&&p.height<=10000&&
  (p.column===null||Number.isInteger(p.column)&&p.column>=0&&p.column+panelSpan(p.width)<=12)&&
  (p.source===null||validSource(p.source))&&(p.fields===null||Array.isArray(p.fields)&&p.fields.every(f=>text(f,256))&&unique(p.fields))&&id(p.presentation)&&validOptions(p.options,v.formatVersion)&&typeof p.hidden==='boolean'&&Number.isSafeInteger(p.count)&&p.count>0&&validPanelConfig(p.config)));
}
// Read old layouts without rewriting them. Explicit preference saves write the upgraded form.
export function upgradeDashboard(v){
 if(validDashboard(v)){
  const next={...structuredClone(v),formatVersion:5};
  for(const item of [...next.shortcuts,...next.views.flatMap(view=>view.panels)])if(['projects','workspace'].includes(item.tool??item.source?.provider)&&['research',null].includes(item.moduleId))item.moduleId='projects';
  return next;
 }
 if(![1,2,3].some(version=>validVersion(v,version)))return null;
 const next=structuredClone(v);next.formatVersion=5;next.shortcuts=defaultShortcuts();next.enabledModules=['research',...(next.enabledTools.includes('website')?['publishing']:[]),...(next.enabledTools.includes('laboratory')?['laboratory']:[])];
 next.views.forEach(view=>view.panels.forEach(panel=>{panel.config??=defaultPanelConfig();panel.height??=0;panel.moduleId=legacyModule(panel.tool);panel.column=null;panel.hidden=!next.enabledTools.includes(panel.tool);panel.source=null;panel.fields=null;panel.presentation=panel.tool==='projects'?'overview':panel.tool==='figures'?'chart':['media','files'].includes(panel.tool)?'media':'summary';panel.options={};}));delete next.enabledTools;return next;
}
export function moveItem(items,from,to){
 if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=items.length||to>=items.length)return items;
 const next=items.slice(),[item]=next.splice(from,1);next.splice(to,0,item);return next;
}

export const panelSpan = width => typeof width==='number'?width:({quarter:3,standard:4,half:6,wide:8,full:12}[width]??4);
