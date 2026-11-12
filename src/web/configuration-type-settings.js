import {configurationEditor} from './configuration-editor.js';
import {defaultPanelConfig} from './dashboard-model.js';
import {validRecordOwner} from './record-collection-client.js';
import {t} from './i18n/index.js';

// Preferences shares the same selected schema editor as project and book settings.
export async function configurationTypeSettings(services,profile){
 const {state,api,esc,field,option,draw,changed}=services;
 const text=(key,args)=>t('configurationEditor',key,args);
 let snapshot=await api('/api/notebook',undefined,{metadataOnly:true,adopt:false}),notebook=null,labs=[],disposed=false,error=null,pending=null;
 // Lab books live in the workspace and in project and lab book stores. The workspace's
 // collection lists those using this type page by page, from each store's configuration
 // index, without opening record bodies; the chosen one is edited through its own store.
 let rootSnapshot=null,total=0,cursor=null,finding=false,controller=null,discovery=0;
 // The whole workspace is searched from its own root, also while a project store is open.
 const workspaceRoot=async signal=>{const result=await api('/api/workspace/read/start',{},{adopt:false,owner:null,signal});if(!result.metadata?.id||typeof result.etag!=='string')throw Error(text('invalid'));return {id:result.metadata.id,etag:result.etag};};
 const root=()=>document.querySelector('[data-module-settings-slot]');
 const editor=configurationEditor({state,api,esc,field,option,draw:()=>{if(!disposed)draw();},onChange:()=>{changed?.();sync();},root:()=>root()?.querySelector('[data-configuration-editor]'),actionName:'module-settings-command'});
 const owner=item=>({workspaceId:item.owner.workspaceId,projectId:item.book.projectId??null,notebookId:item.book.id,slot:'configuration'});
 const route=item=>item.owner.projectId?{projectId:item.owner.projectId,...(item.owner.labBookId?{labBookId:item.owner.labBookId}:{})}:null;
 const label=item=>[item.owner.projectTitle,item.book.title].filter(Boolean).join(' / ');
 async function discover({more=false}={}){
  controller?.abort();const request=new AbortController(),epoch=++discovery;controller=request;finding=true;if(!more){labs=[];total=0;cursor=null;}if(!disposed)draw();
  try{
   const base=more&&rootSnapshot?rootSnapshot:rootSnapshot=await workspaceRoot(request.signal);if(epoch!==discovery)return;
   const result=await api('/api/projects/dashboard-collection/structure',{workspaceId:base.id,etag:base.etag,provider:'laboratory-'+profile.id+'-spaces',config:defaultPanelConfig(),options:{},limit:25,key:null,cursor:more?cursor:null},{adopt:false,signal:request.signal});
   if(epoch!==discovery)return;
   if(result.workspaceId!==base.id||!Array.isArray(result.items)||!Number.isSafeInteger(result.total)||result.items.some(item=>!validRecordOwner(item.owner)||typeof item.data?.id!=='string'))throw Error(text('invalid'));
   labs=[...labs,...result.items.map(item=>({key:item.key,owner:item.owner,book:item.data}))];total=result.total;cursor=result.nextCursor;
  }finally{if(epoch===discovery){finding=false;controller=null;}}
 }
 async function select(key){
  const next=labs.find(item=>item.key===key)??labs[0];if(!next){notebook=null;return;}
  await editor.open(owner(next),{profileId:profile.id,owner:route(next)});notebook=next;
 }
 await discover();await select();
 const isDirty=()=>editor.isDirty();
 const statusText=()=>error?.message??text(pending?'saving':isDirty()?'unsaved':'saved');
 // Edits change the save state in place, so typing never redraws the editor around the field being edited.
 function sync(){
  const scope=root()?.querySelector('.lab-type-settings');if(!scope)return;
  const status=scope.querySelector('[data-type-settings-status]');if(status&&status.textContent!==statusText())status.textContent=statusText();
  for(const command of ['save','cancel']){const button=scope.querySelector('[data-type-settings-button][data-command="'+command+'"]');if(button)button.disabled=Boolean(pending)||!isDirty();}
 }
 async function save(){
  if(pending)return pending;
  pending=(async()=>{
   try{await editor.save();const latest=await api('/api/notebook',undefined,{metadataOnly:true,adopt:false});snapshot=latest;if(state.book.id===snapshot.book.id){state.book=snapshot.book;state.etag=snapshot.etag;}error=null;}
   catch(reason){error=reason;throw reason;}finally{pending=null;if(!disposed){draw();changed?.();}}
  })();return pending;
 }
 async function discard(){if(pending)await pending;await editor.discard();error=null;draw();changed?.();}
 function view(){
  const found='<p role="status" data-configuration-labs-status>'+esc(finding?text('findingBooks'):total?text('foundBooks',{shown:labs.length,total}):'')+'</p>'+(cursor&&!finding?'<button type="button" class="button subtle" data-action="module-settings-command" data-command="more-books">'+esc(text('moreBooks'))+'</button>':'');
  if(!notebook)return finding?found:'<p>'+esc(text('noProfileBooks'))+'</p>';
  return '<div class="lab-type-settings">'+field(esc(text('labBook')),'<select data-configuration-lab '+(pending?'disabled':'')+'>'+labs.map(item=>option(item.key,label(item),notebook.key)).join('')+'</select>')+found+editor.view()+
   '<p role="status" data-type-settings-status>'+esc(statusText())+'</p><div class="inline-actions"><button type="button" class="button" data-action="module-settings-command" data-command="cancel" data-type-settings-button '+(pending||!isDirty()?'disabled':'')+'>'+esc(text('cancel'))+'</button><button type="button" class="button primary" data-action="module-settings-command" data-command="save" data-type-settings-button '+(pending||!isDirty()?'disabled':'')+'>'+esc(text('save'))+'</button></div></div>';
 }
 function input(element){
  if(element.hasAttribute('data-configuration-lab')){
   if(isDirty()){element.value=notebook.key;error=Error(text('saveBeforeBook'));draw();}
   else void select(element.value).then(()=>draw()).catch(reason=>{error=reason;draw();});return true;
  }
  return editor.input(element);
 }
 async function action(name,node){if(name==='save'){await save();return;}if(name==='cancel'){await discard();return;}if(name==='more-books'){await discover({more:true});draw();return;}await editor.action(node);}
 async function activate(){if(isDirty()||disposed)return;snapshot=await api('/api/notebook',undefined,{metadataOnly:true,adopt:false});await discover();await select(notebook?.key);}
 return {view,input,action,activate,isDirty,save,discard,bind(){},dispose(){disposed=true;controller?.abort();editor.stop();}};
}
