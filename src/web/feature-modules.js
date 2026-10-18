import {toolModules} from './tools/manifests.js';
import organizationMessages from './locales/en/organizations.json' with {type:'json'};
import publishingMessages from './locales/en/publishingData.json' with {type:'json'};
import {inventoryItems,inventoryReference} from './modules/inventory-model.js';
import {laboratoryModules} from './laboratory/modules.js';
// Lightweight manifests belong to app composition. Modules register their own
// capabilities; dashboard and navigation discover those registrations.
export const FEATURE_MODULES=[
 ...toolModules,
 {id:'pdf-editor',parentId:'publishing',required:true,metadataOnly:true,pages:[],label:'PDF editor',description:'Compose independent PDF documents with their own text and page layouts.',navigation:[{action:'module-open',moduleId:'pdf-editor',label:'PDF editor',icon:'records'}],load:async()=>()=>{},createUI:services=>import('./pdf-editor-ui.js').then(m=>m.pdfEditorUI(services))},
 {id:'organizations',label:organizationMessages.title,description:organizationMessages.description,metadataOnly:true,pages:[],navigation:[{action:'module-open',moduleId:'organizations',label:organizationMessages.title,icon:'records'}],load:async()=>()=>{},createUI:services=>import('./organizations-workbench.js').then(m=>m.organizationsWorkbench(services))},
 {id:'collaboration',label:'Collaboration',description:'Verified contacts, encrypted review exchange and signed record reviews.',metadataOnly:true,pages:[],navigation:[{action:'module-open',moduleId:'collaboration',label:'Collaboration',icon:'records'}],load:async()=>()=>{},createUI:services=>services.reviews.moduleUI()},
 {id:'resources',metadataOnly:true,reference:inventoryReference,locationTool:{label:'Inventory',path:'resource',types:['resource'],scopeItems:inventoryItems},projectSettings:{heading:'Inventory locations',intro:'Workspace inventory is available here without selecting any projects. Choose which projects show an inventory view. Enabling a view does not assign stock; use transfers to allocate it.',action:'Choose inventory locations',openLabel:'Open inventory'},entityTypes:['resource','category','movement','reservation','stock-transfer','asset-transfer','bom'],label:'Inventory',description:'Owned items, materials, equipment and software. Track central stock and its allocation across projects.',pages:[],navigation:[{action:'module-open',moduleId:'resources',label:'Inventory',icon:'folder'}],load:()=>import('./modules/operations-data.js').then(m=>m.registerResources),createUI:services=>import('./modules/resources-ui.js').then(m=>m.createResourcesUI(services))},
 {id:'planning',metadataOnly:true,locationTool:{label:'Calendar & planning',path:'agenda',types:['calendar','task','booking','event']},entityTypes:['task','booking','calendar','event','subscription','calendar-connection'],label:'Planning',description:'Calendars, tasks and equipment bookings for each location and your combined overview.',pages:[],navigation:[{action:'module-open',moduleId:'planning',label:'Calendar & planning',icon:'records'}],load:()=>import('./modules/operations-data.js').then(m=>m.registerPlanning),createUI:services=>import('./modules/planning-ui.js').then(m=>m.createPlanningUI(services))},
 {id:'projects',required:true,pages:['projects','project'],label:'Projects',description:'Organize projects within the workspace.',navigation:[],load:()=>import('./research-data.js').then(m=>m.registerProjectData)},
 {id:'research',required:true,settingsHeading:'Lab-book types',pages:['entries','editor'],label:'Lab books',description:'Lab books are always available within projects. Enable the types you need, or create your own record templates in any lab book.',childrenDescription:'Enabled types provide starter templates when you create or edit a lab book. Turning a type off keeps existing lab books, records and customizations.',navigation:[],load:()=>import('./research-data.js').then(m=>m.registerLabBookData)},
 {id:'laboratory',metadataOnly:true,defaultPage:'projects',entityTypes:[],aliases:[],pages:['laboratory'],label:'Sample analysis',description:'Register samples, enter analysis results and review result sheets.',navigation:[],load:()=>import('./laboratory-data.js').then(m=>m.registerLaboratoryData)},
 ...laboratoryModules,
 {id:'publishing',navigationGroup:'website',pages:['website','publishing','review','integrations','appearance'],label:publishingMessages.group,description:'Compose a website from research and prepare it for publication.',navigation:[{action:'website',label:'Website editor',icon:'eye'},{action:'publishing',label:'Publishing',icon:'export'}],load:()=>import('./publishing-data.js').then(m=>m.registerPublishingData)}
];
export const moduleChildren=(id=null,modules=FEATURE_MODULES)=>modules.filter(m=>(m.parentId??null)===id);
export function enabledModule(settings,id,modules=FEATURE_MODULES){
 const selected=new Set(settings?.enabledModules??['publishing']),seen=new Set();
 for(let current=id;current;current=modules.find(m=>m.id===current)?.parentId){
  if((!selected.has(current)&&!modules.find(m=>m.id===current)?.required)||seen.has(current))return false;
  seen.add(current);
 }
 return true;
}
// Setup, preferences and creation discover the same registered lab-book types.
export const labBookTypeModules=()=>moduleChildren('research').filter(m=>m.labBookType);
export const enabledLabBookTypes=settings=>labBookTypeModules().filter(m=>enabledModule(settings,m.id)).map(m=>m.labBookType);
export const validLabBookTypeSelection=ids=>Array.isArray(ids)&&new Set(ids).size===ids.length&&ids.every(id=>labBookTypeModules().some(m=>m.id===id));
export function createModuleHost(registry,modules=FEATURE_MODULES){
 const active=new Map(),errors=new Map();let revision=0,selection=[];
 return {
  async configure(ids){
   selection=[...ids];const current=++revision,wanted=new Set(modules.filter(m=>enabledModule({enabledModules:selection},m.id,modules)).map(m=>m.id));
   for(const [id,disposers] of active)if(!wanted.has(id)){disposers.forEach(dispose=>dispose());active.delete(id);}
   await Promise.all(modules.filter(m=>wanted.has(m.id)&&!active.has(m.id)).map(async m=>{
    const disposers=[];
    try{
     const register=await m.load();if(current!==revision)return;
     register({register:provider=>{const dispose=registry.register({...provider,moduleId:m.id,items:(context,data,options)=>provider.items({...context,enabledModules:selection},data,options)});disposers.push(dispose);return dispose;}});
     active.set(m.id,disposers);errors.delete(m.id);
    }catch(error){disposers.forEach(dispose=>dispose());errors.set(m.id,error);}
   }));
  },
  error:id=>errors.get(id),isLoaded:id=>active.has(id)
 };
}

export const moduleForPage=page=>FEATURE_MODULES.find(m=>(m.pages??[]).includes(page));
// Additional feature manifests participate in settings, menus and generic routes.
export function registerFeatureModule(module){
 if(!module||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(module.id)||typeof module.label!=='string'||typeof module.load!=='function')throw new TypeError('A feature module needs id, label and load.');
 if(module.parentId&&!FEATURE_MODULES.some(m=>m.id===module.parentId))throw new Error('Unknown parent module: '+module.parentId);
 if(FEATURE_MODULES.some(m=>m.id===module.id))throw new Error('Duplicate module: '+module.id);
 const value=Object.freeze({description:'',pages:[],navigation:[{action:'module-open',moduleId:module.id,label:module.label,icon:'folder'}],...module});
 FEATURE_MODULES.push(value);return value;
}

// Specialized owners take precedence over a parent fallback for shared entities.
export function moduleForEntity(entity,entities){
 const candidates=FEATURE_MODULES.filter(m=>m.entityTypes?.includes(entity.type));
 return candidates.find(m=>m.ownsEntity?.(entity,entities))??candidates.find(m=>!m.ownsEntity);
}

// Modules with notebook tools may direct legacy entry URLs to their shared owner.
export const moduleDestination=id=>FEATURE_MODULES.find(m=>m.id===id)?.defaultPage??null;
