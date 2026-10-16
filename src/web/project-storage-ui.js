import {projectPlacementUI} from './project-placement-ui.js';
import {projectAccessSettingsUI} from './project-access-settings-ui.js';
import {localizedText} from './i18n/index.js';
const text=localizedText('projectStorage');
// Project storage owns its commands and selected location. A transfer may
// outlive this view; returning reads its durable command status.
export function projectStorageUI({state,api,esc,field,showDialog,deleteProject,accessProject=operation=>operation(),projectRoot=()=>null,projectDirectory,rootBook,moved=async()=>{}}){
 const accessSettings=projectAccessSettingsUI({state,api,esc,field});
 const entries=new Map();let dialogCommand=null;
 const placement=projectPlacementUI({state,api,esc,field,accessProject,projectDirectory,rootBook,changed:id=>paint(current(id)),finished:async(id,result,targetPath)=>{if(result?.workspaceId){await moved(result,targetPath);return;}const entry=current(id);entry.data=null;entry.version++;await load(entry);}});
 const key=id=>JSON.stringify([state.storage?.contextId,id]);
 const current=id=>{const idKey=key(id);if(!entries.has(idKey))entries.set(idKey,{id,context:state.storage?.contextId,loading:false,pending:false,data:null,error:'',root:null,version:0});return entries.get(idKey);};
 const host=entry=>entry.context===state.storage?.contextId?document.querySelector('[data-project-storage="'+entry.id+'"]'):null;
 const button=(label,action,extra='')=>'<button type="button" class="button" data-action="project-storage-'+action+'" '+extra+'>'+esc(text(label))+'</button>';
 function paint(entry){
  const node=host(entry);if(!node)return;
  const data=entry.data,pending=entry.pending||placement.busy(entry.id)||data?.copy?.running||data?.move?.running||data?.export?.running;
  const signature=JSON.stringify([pending,data,entry.error,entry.loading&&!data]);if(node.dataset.signature===signature)return;node.dataset.signature=signature;
  node.innerHTML='<h2>'+esc(text('title'))+'</h2>'+(data?'<p class="storage-path">'+esc(data.path)+'</p><div class="inline-actions">'+button('copy','copy',pending?'disabled':'')+button('export','export',pending?'disabled':'')+button('move','move',pending?'disabled':'')+button('delete','delete',pending?'disabled':'')+'</div>':'<p role="status">'+esc(text(entry.loading?'loading':'unavailable'))+'</p>')+
   (entry.error?'<p role="alert">'+esc(entry.error)+'</p>'+button('retry','refresh'):'')+
   (!pending&&data?['copy','export','move'].filter(kind=>data[kind]&&!['complete','cancelled'].includes(data[kind].phase)).map(kind=>'<p>'+esc(text(kind+'Pending'))+'</p>'+button('resume','resume','data-kind="'+kind+'"')+(data[kind].canCancel?button('cancelTransfer','cancel-transfer','data-kind="'+kind+'"'):'')).join(''):'')+
   (data?['copy','export','move'].filter(kind=>data[kind]?.phase==='cancelled').map(kind=>'<p>'+esc(text('cancelled',{path:data[kind].destination}))+'</p>').join(''):'')+
   (pending?'<p role="status">'+esc(text(placement.busy(entry.id)||data?.move?.running&&data.move.mode==='placement'?'movingTree':'working'))+'</p>':'')+
   (data?.copy?.phase==='complete'?'<p>'+esc(text('copied',{path:data.copy.destination}))+'</p>':'')+
   (data?.export?.phase==='complete'?'<p>'+esc(text('exported',{path:data.export.destination}))+'</p>':'');
 }
 async function load(entry){
  if(entry.loading)return;entry.loading=true;const version=entry.version;paint(entry);
  try{const data=await api('/api/projects/'+entry.id+'/storage/details',{}, {adopt:false});if(version===entry.version){entry.data=data;entry.error='';}}
  catch(error){if(version===entry.version)entry.error=error.message??text('unavailable');}finally{entry.loading=false;if(version!==entry.version&&host(entry))void load(entry);else paint(entry);}
 }
 async function run(entry,kind,command,resume=false){
  if(entry.pending)return;entry.pending=true;entry.error='';paint(entry);const view=location.hash;
  try{await accessProject(()=>api('/api/projects/'+entry.id+'/storage/'+kind+(resume?'/resume':''),command,{adopt:false,view}));await load(entry);}
  catch(error){entry.error=error.name==='AbortError'?'':error.message??text('failed');try{entry.data=await api('/api/projects/'+entry.id+'/storage/details',{}, {adopt:false});}catch{} }
  finally{entry.pending=false;paint(entry);}
 }
 setInterval(()=>{for(const entry of entries.values())if(host(entry)&&!entry.pending&&(entry.data?.copy?.running||entry.data?.move?.running||entry.data?.export?.running))void load(entry);},1500);
 return {
  view(){const id=state.projectOwner?.projectId;return id&&id===state.project?'<section class="panel" data-project-storage="'+id+'"></section>'+placement.view(id)+accessSettings.view(id):'';},
  bind(){const id=state.projectOwner?.projectId;if(!id)return;placement.bind(id);accessSettings.bind(id);const entry=current(id);if(!host(entry))return;const root=projectRoot(id);if(root&&root!==entry.root){entry.root=root;entry.version++;entry.data=null;entry.error='';}if(!entry.data&&!entry.loading&&!entry.error)void load(entry);else paint(entry);},
  choiceAction:node=>placement.choiceAction(node),input:element=>placement.input(element),
  async action(node){
   if(await placement.action(node))return true;
   const action=node.dataset.action;if(!action?.startsWith('project-storage-'))return false;
   const id=state.projectOwner?.projectId;if(!id)return true;const entry=current(id);if(entry.pending||placement.busy(entry.id)||entry.data?.copy?.running||entry.data?.move?.running||entry.data?.export?.running)return true;
   if(action==='project-storage-move'){if(entry.data)placement.open(id,entry.data.parentId);return true;}
   if(action==='project-storage-delete'){deleteProject(entry);return true;}
   if(action==='project-storage-refresh'){await load(entry);return true;}
   if(action==='project-storage-cancel-transfer'){const kind=node.dataset.kind,command=entry.data?.[kind];if(['copy','export','move'].includes(kind)&&command?.canCancel)await run(entry,kind+'/cancel',{id:command.id});return true;}
   if(action==='project-storage-resume'){const kind=node.dataset.kind,command=entry.data?.[kind];if(['copy','export','move'].includes(kind)&&command)await run(entry,kind,{id:command.id},true);return true;}
   const kind=action.slice('project-storage-'.length);if(!['copy','export'].includes(kind))return true;
   dialogCommand={entry,kind,id:crypto.randomUUID()};
   showDialog('<form id="project-storage-form" data-no-draft><h2 id="dialog-title">'+esc(text(kind))+'</h2>'+field(text('destinationParent'),'<input id="project-storage-path" name="path" required autocomplete="off" spellcheck="false">')+'<button type="button" class="button" data-action="storage-browse" data-target="project-storage-path">'+esc(text('choose'))+'</button><p>'+esc(text(kind+'Effect'))+'</p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">'+esc(text('cancel'))+'</button><button type="submit" class="button primary">'+esc(text(kind))+'</button></div></form>');return true;
  },
  async submit(form){
   if(await placement.submit(form))return true;
   if(await accessSettings.submit(form))return true;
   if(form.id!=='project-storage-form')return false;const command=dialogCommand;if(!command||command.entry.context!==state.storage?.contextId)return true;
   const input=form.elements.path.value.trim();if(!input)return true;dialogCommand=null;document.querySelector('#dialog').close();await run(command.entry,command.kind,{id:command.id,parent:input});return true;
  }
 };
}
