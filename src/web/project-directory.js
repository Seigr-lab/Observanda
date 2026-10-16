import {ancestors} from './workspace-structure.js';
import {placeAt,updateText,updateProperty} from './progress-dom.js';
import {hasProjectDirectory} from './project-directory-capability.js';
import {localizedText} from './i18n/index.js';
const text=localizedText('projectDirectory');
// Only directory summaries are cached here. Never adopt them as editable
// research metadata or hydrate every project's database to build navigation.
export function projectDirectory({state,api,esc,changed}){
 let context=state.storage?.contextId,kind=state.storage?.researchStorage,pages=new Map(),generation=0,lastView=null,completedCommands='';
 const available=()=>hasProjectDirectory(state);
 function sync(){if(context!==state.storage?.contextId||kind!==state.storage?.researchStorage){context=state.storage?.contextId;kind=state.storage?.researchStorage;pages=new Map();generation++;lastView=null;completedCommands='';}}
 const page=parentId=>{sync();if(!pages.has(parentId))pages.set(parentId,{parentId,items:[],ancestors:[],revision:null,total:0,loaded:false,loading:false,error:'',depth:0,requestedDepth:1});return pages.get(parentId);};
 const summary=entry=>({id:entry.projectId,parentId:entry.parentId,...(entry.summary??{title:text('unnamed',{id:entry.projectId}),description:'',kind:text('project')}),share:false,logoId:null});
 function entries(){sync();const found=new Map();for(const value of pages.values())for(const entry of [...value.ancestors,...value.items])found.set(entry.projectId,entry);return [...found.values()];}
 async function load(value,{more=false,retry=true,depth=1}={}){
  if(!available()||value.loading)return;const captured=generation;value.loading=true;value.error='';value.requestedDepth=more?value.depth+1:depth;paint(value);
  try{
   for(let attempt=0;;attempt++){
    const append=more&&attempt===0,target=append?value.depth+1:more?1:depth,items=append?[...value.items]:[];let revision=append?value.revision:null,count=append?value.depth:0,result;
    try{
     do{
      result=await api('/api/projects/list',{parentId:value.parentId,offset:items.length,limit:50,revision},{adopt:false});
      sync();if(captured!==generation)return;items.push(...result.projects);revision=result.revision;count++;
     }while(items.length<result.total&&count<target);
     Object.assign(value,{items,ancestors:result.ancestors,total:result.total,revision,loaded:true,depth:count,requestedDepth:count});break;
    }catch(error){sync();if(captured!==generation)return;if(error.code==='CONFLICT'&&(more||depth>1)&&retry&&attempt===0)continue;value.error=error.message??text('failed');break;}
   }
  }finally{if(captured===generation){value.loading=false;paint(value);changed();}}
 }
 function card(entry){const p=summary(entry);return '<article class="project-card" data-directory-project="'+p.id+'"><span class="scope-kicker">'+esc(p.kind)+'</span><h2><button class="card-title" data-action="open-project" data-id="'+p.id+'">'+esc(p.title)+'</button></h2><p class="subtitle" '+(p.description?'':'hidden')+'>'+esc(p.description)+'</p><div class="inline-actions"><button class="button" data-action="edit-project" data-id="'+p.id+'">'+esc(text('settings'))+'</button></div></article>';}
 function navigation(book){const combined=new Map(book.projects.map(p=>[p.id,p]));for(const entry of entries()){const selected=!state.projectOwner?.labBookId&&state.projectOwner?.projectId===entry.projectId?state.book.projects.find(p=>p.id===entry.projectId):null;combined.set(entry.projectId,{...summary(entry),...selected,parentId:entry.parentId});}return {...book,projects:[...combined.values()]};}
 const parents=id=>ancestors(navigation(state.book),id).slice(0,-1);
 const ancestor=p=>'<span data-project-ancestor="'+p.id+'"> / <button class="text-button" data-action="open-project" data-id="'+p.id+'">'+esc(p.title)+'</button></span>';
 function trail(projectId,workspaceTitle){return '<nav class="location-trail" aria-label="Project hierarchy" data-project-trail="'+projectId+'"><button class="text-button" data-action="projects">'+esc(workspaceTitle)+'</button>'+parents(projectId).map(ancestor).join('')+'</nav>';}
 function paint(value){
  const document=globalThis.document;if(!document||!state.book||state.access?.locked||state.storageUnavailable)return;
  const focused=document.activeElement,host=document.querySelector('[data-project-directory="'+(value.parentId??'root')+'"]');
  if(host){
   const grid=host.querySelector('.project-grid'),ids=new Set(value.items.map(entry=>entry.projectId));
   for(const node of [...grid.children])if(!ids.has(node.dataset.directoryProject))node.remove();
   value.items.forEach((entry,index)=>{const p=summary(entry);let node=grid.querySelector('[data-directory-project="'+p.id+'"]');if(!node){const template=document.createElement('template');template.innerHTML=card(entry);node=template.content.firstElementChild;}else{updateText(node.querySelector('.scope-kicker'),p.kind);updateText(node.querySelector('.card-title'),p.title);updateText(node.querySelector('.subtitle'),p.description);updateProperty(node.querySelector('.subtitle'),'hidden',!p.description);}placeAt(grid,node,index);});
   updateProperty(grid,'hidden',!value.items.length);
   const error=host.querySelector('[data-project-error]');updateText(error,value.error);updateProperty(error,'hidden',!value.error);
   updateProperty(host.querySelector('[data-action="project-directory-retry"]'),'hidden',!value.error);
   updateProperty(host.querySelector('[data-project-loading]'),'hidden',!value.loading||!!value.error);
   const more=host.querySelector('[data-action="project-directory-more"]');updateProperty(more,'hidden',!value.loaded||value.items.length>=value.total);updateProperty(more,'disabled',value.loading);
  }
  for(const node of document.querySelectorAll('[data-project-trail]')){
   const rows=parents(node.dataset.projectTrail),ids=new Set(rows.map(parent=>parent.id));
   for(const child of [...node.querySelectorAll('[data-project-ancestor]')])if(!ids.has(child.dataset.projectAncestor))child.remove();
   rows.forEach((parent,index)=>{let child=node.querySelector('[data-project-ancestor="'+parent.id+'"]');if(!child){const template=document.createElement('template');template.innerHTML=ancestor(parent);child=template.content.firstElementChild;}else updateText(child.querySelector('button'),parent.title);placeAt(node,child,index+1);});
  }
  if(focused?.isConnected&&document.activeElement!==focused&&!focused.disabled)focused.focus({preventScroll:true});
 }
 function cards(parentId){
  sync();if(!available())return '';
  const value=page(parentId);
  return '<div data-project-directory="'+(parentId??'root')+'"><div class="project-grid" '+(value.items.length?'':'hidden')+'>'+value.items.map(card).join('')+'</div>'+
   '<p role="alert" data-project-error '+(value.error?'':'hidden')+'>'+esc(value.error)+'</p><button class="button" data-action="project-directory-retry" data-parent="'+(parentId??'')+'" '+(value.error?'':'hidden')+'>'+esc(text('retry'))+'</button><p role="status" data-project-loading '+(value.loading&&!value.error?'':'hidden')+'>'+esc(text('loading'))+'</p>'+
   '<button class="button" data-action="project-directory-more" data-parent="'+(parentId??'')+'" '+(value.loaded&&value.items.length<value.total?'':'hidden ')+(value.loading?'disabled':'')+'>'+esc(text('more'))+'</button></div>';
 }
 async function refresh(){
  sync();generation++;
  // Keep visible rows while replacement pages are read so focus and ancestry
  // do not disappear between requests. Other owners reload on entry.
  const visible=state.projectOwner?.projectId;pages=new Map([...pages].filter(([id])=>id===null||id===visible).map(([id,value])=>[id,{...value,loading:false}]));
  await load(page(null),{depth:page(null).requestedDepth});
  if(state.projectOwner){const value=page(state.projectOwner.projectId);await load(value,{depth:value.requestedDepth});}
 }

 return {entries,cards,trail,
  // Completion invalidates display summaries; the registry remains their data
  // source. Progress ticks never reread directory metadata or project payloads.
  async activity(snapshot){
   sync();if(!available()||!state.book||state.access?.locked||snapshot.contextId!==context)return;
   const commands=snapshot.operations.filter(entry=>entry.state==='completed'&&(/^\/api\/projects\/(?:(?:open|create|convert)(?:\/resume)?)$/.test(entry.kind)||/^\/api\/projects\/[a-f0-9-]{36}\/(?:directory\/reparent|settings\/save|workspace\/structure|storage\/(?:move|delete)(?:\/resume)?)$/.test(entry.kind))).map(entry=>entry.id).sort().join();
   if(commands===completedCommands)return;completedCommands=commands;if(commands)await refresh();
  },
  navigation,
  bind(){sync();if(!available()||!state.book||state.access?.locked||state.storageUnavailable||state.newWorkspace)return;const view=state.page==='projects'?'root':state.page==='project'?state.projectOwner?.projectId??null:null,entered=view!==null&&view!==lastView;lastView=view;for(const parentId of [null,...(state.projectOwner?[state.projectOwner.projectId]:[])]){const value=page(parentId);if(!value.loading&&(entered||!value.loaded&&!value.error))void load(value,{depth:value.requestedDepth});}},
  refresh,
  async action(node){if(!node.dataset.action?.startsWith('project-directory-'))return false;const value=page(node.dataset.parent||null);await load(value,{more:node.dataset.action==='project-directory-more',depth:value.requestedDepth});return true;}
 };
}
