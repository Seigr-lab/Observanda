import {configurationEditor} from './configuration-editor.js';
import {configurationDocumentClient} from './configuration-document-client.js';
import {locationName} from './workspace-structure.js';
import {t} from './i18n/index.js';

// Preferences shares the same selected schema editor as project and book settings.
export async function configurationTypeSettings(services,profile){
 const {state,api,esc,field,option,draw,changed}=services;
 const text=(key,args)=>t('configurationEditor',key,args);
 let snapshot=await api('/api/notebook',undefined,{metadataOnly:true,adopt:false}),notebook=null,labs=[],disposed=false,error=null,pending=null;
 const root=()=>document.querySelector('[data-module-settings-slot]');
 const editor=configurationEditor({state,api,esc,field,option,draw:()=>{if(!disposed)draw();},onChange:changed,root:()=>root()?.querySelector('[data-configuration-editor]'),actionName:'module-settings-command'});
 const reader=configurationDocumentClient({state,api});
 const owner=book=>({workspaceId:snapshot.book.id,projectId:book.projectId,notebookId:book.id,slot:'configuration'});
 async function discover(){
  const found=[];
  for(const book of snapshot.book.notebooks){
   await reader.open(owner(book),{saved:true});
   const result=await reader.profiles([profile.id]),row=result.profiles.find(row=>row.id===profile.id);
   if(row?.enabled)found.push(book);
  }
  labs=found;reader.stop();
 }
 async function select(id){
  const next=labs.find(book=>book.id===id)??labs[0];if(!next){notebook=null;return;}
  await editor.open(owner(next),{profileId:profile.id});notebook=next;
 }
 await discover();await select();
 const isDirty=()=>editor.isDirty();
 async function save(){
  if(pending)return pending;
  pending=(async()=>{
   try{await editor.save();const latest=await api('/api/notebook',undefined,{metadataOnly:true,adopt:false});snapshot=latest;if(state.book.id===snapshot.book.id){state.book=snapshot.book;state.etag=snapshot.etag;}error=null;}
   catch(reason){error=reason;throw reason;}finally{pending=null;if(!disposed){draw();changed?.();}}
  })();return pending;
 }
 async function discard(){if(pending)await pending;await editor.discard();error=null;draw();changed?.();}
 function view(){
  if(!notebook)return '<p>'+esc(text('noProfileBooks'))+'</p>';
  return '<div class="lab-type-settings">'+field(esc(text('labBook')),'<select data-configuration-lab '+(pending?'disabled':'')+'>'+labs.map(book=>option(book.id,locationName(snapshot.book,book.projectId)+' / '+book.title,notebook.id)).join('')+'</select>')+editor.view()+
   '<p role="status">'+esc(error?.message??text(pending?'saving':isDirty()?'unsaved':'saved'))+'</p><div class="inline-actions"><button type="button" class="button" data-action="module-settings-command" data-command="cancel" '+(pending||!isDirty()?'disabled':'')+'>'+esc(text('cancel'))+'</button><button type="button" class="button primary" data-action="module-settings-command" data-command="save" '+(pending||!isDirty()?'disabled':'')+'>'+esc(text('save'))+'</button></div></div>';
 }
 function input(element){
  if(element.hasAttribute('data-configuration-lab')){
   if(isDirty()){element.value=notebook.id;error=Error(text('saveBeforeBook'));draw();}
   else void select(element.value).then(()=>draw()).catch(reason=>{error=reason;draw();});return true;
  }
  return editor.input(element);
 }
 async function action(name,node){if(name==='save'){await save();return;}if(name==='cancel'){await discard();return;}await editor.action(node);}
 async function activate(){if(isDirty()||disposed)return;snapshot=await api('/api/notebook',undefined,{metadataOnly:true,adopt:false});await discover();await select(notebook?.id);}
 return {view,input,action,activate,isDirty,save,discard,bind(){},dispose(){disposed=true;editor.stop();reader.stop();}};
}
