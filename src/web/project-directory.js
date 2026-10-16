import {localizedText} from './i18n/index.js';
const text=localizedText('projectDirectory');
// Only directory summaries are cached here. Never adopt them as editable
// research metadata or hydrate every project's database to build navigation.
export function projectDirectory({state,api,esc,changed}){
 let context=state.storage?.contextId,pages=new Map(),generation=0,lastView=null,completedCommands='';
 function sync(){if(context!==state.storage?.contextId){context=state.storage?.contextId;pages=new Map();generation++;lastView=null;completedCommands='';}}
 const page=parentId=>{sync();if(!pages.has(parentId))pages.set(parentId,{parentId,items:[],ancestors:[],revision:null,total:0,loaded:false,loading:false,error:''});return pages.get(parentId);};
 const summary=entry=>({id:entry.projectId,parentId:entry.parentId,...(entry.summary??{title:text('unnamed',{id:entry.projectId}),description:'',kind:text('project')}),share:false,logoId:null});
 function entries(){sync();const found=new Map();for(const value of pages.values())for(const entry of [...value.ancestors,...value.items])found.set(entry.projectId,entry);return [...found.values()];}
 async function load(value,{more=false,retry=true}={}){
  if(value.loading)return;const captured=generation;value.loading=true;value.error='';
  try{
   const result=await api('/api/projects/list',{parentId:value.parentId,offset:more?value.items.length:0,limit:50,revision:more?value.revision:null},{adopt:false});
   sync();if(captured!==generation)return;
   value.items=more?[...value.items,...result.projects]:result.projects;value.ancestors=result.ancestors;value.total=result.total;value.revision=result.revision;value.loaded=true;
  }catch(error){if(captured!==generation)return;if(error.code==='CONFLICT'&&more&&retry){value.loading=false;return load(value,{retry:false});}value.error=error.message??text('failed');}
  finally{if(captured===generation){value.loading=false;changed();}}
 }
 function cards(parentId){
  const value=page(parentId);
  return '<div data-project-directory="'+(parentId??'root')+'">'+(value.items.length?'<div class="project-grid">'+value.items.map(entry=>{const p=summary(entry);return '<article class="project-card"><span class="scope-kicker">'+esc(p.kind)+'</span><h2><button class="card-title" data-action="open-project" data-id="'+p.id+'">'+esc(p.title)+'</button></h2>'+(p.description?'<p>'+esc(p.description)+'</p>':'')+'<div class="inline-actions"><button class="button" data-action="edit-project" data-id="'+p.id+'">'+esc(text('settings'))+'</button></div></article>';}).join('')+'</div>':'')+
   (value.error?'<p role="alert">'+esc(value.error)+'</p><button class="button" data-action="project-directory-retry" data-parent="'+(parentId??'')+'">'+esc(text('retry'))+'</button>':value.loading?'<p role="status">'+esc(text('loading'))+'</p>':'')+
   (value.loaded&&value.items.length<value.total?'<button class="button" data-action="project-directory-more" data-parent="'+(parentId??'')+'" '+(value.loading?'disabled':'')+'>'+esc(text('more'))+'</button>':'')+'</div>';
 }
 async function refresh(){sync();generation++;pages=new Map();await load(page(null));if(state.projectOwner)await load(page(state.projectOwner.projectId));}
 return {entries,cards,
  // Completion invalidates display summaries; the registry remains their data
  // source. Progress ticks never reread directory metadata or project payloads.
  async activity(snapshot){
   sync();if(!state.book||state.access?.locked||snapshot.contextId!==context)return;
   const commands=snapshot.operations.filter(entry=>entry.state==='completed'&&(/^\/api\/projects\/(?:(?:open|create|convert)(?:\/resume)?)$/.test(entry.kind)||/^\/api\/projects\/[a-f0-9-]{36}\/(?:directory\/reparent|settings\/save|workspace\/structure|storage\/(?:move|delete)(?:\/resume)?)$/.test(entry.kind))).map(entry=>entry.id).sort().join();
   if(commands===completedCommands)return;completedCommands=commands;if(commands)await refresh();
  },
  navigation(book){const combined=new Map(book.projects.map(p=>[p.id,p]));for(const entry of entries()){const selected=!state.projectOwner?.labBookId&&state.projectOwner?.projectId===entry.projectId?state.book.projects.find(p=>p.id===entry.projectId):null;combined.set(entry.projectId,{...summary(entry),...selected,parentId:entry.parentId});}return {...book,projects:[...combined.values()]};},
  bind(){sync();if(!state.book||state.access?.locked||state.storageUnavailable||state.newWorkspace)return;const view=state.page==='projects'?'root':state.page==='project'?state.projectOwner?.projectId??null:null,entered=view!==null&&view!==lastView;lastView=view;for(const parentId of [null,...(state.projectOwner?[state.projectOwner.projectId]:[])]){const value=page(parentId);if(!value.loading&&(entered||!value.loaded&&!value.error))void load(value);}},
  refresh,
  async action(node){if(!node.dataset.action?.startsWith('project-directory-'))return false;await load(page(node.dataset.parent||null),{more:node.dataset.action==='project-directory-more'});return true;}
 };
}
