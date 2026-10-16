import {localizedText} from './i18n/index.js';
const text=localizedText('projectDeletion');
// The Projects route owns deletion and restart recovery. Navigation never owns
// the operation; the service's encrypted receipt survives the window.
export function projectDeletionUI({state,api,accessProject=operation=>operation(),esc,field,showDialog,enterProject,render,refreshDirectory}){
 let context,generation=0,items=[],next=null,error='',notice='',command=null,loading=false,loaded=false,wasVisible=false;let pending=new Map();
 const visible=()=>state.page==='projects'&&!state.access?.locked&&!state.storageUnavailable;
 function sync(){if(context!==state.storage?.contextId){context=state.storage?.contextId;generation++;items=[];next=null;error=notice='';command=null;loading=loaded=wasVisible=false;pending=new Map();}}
 const current=token=>token===generation&&context===state.storage?.contextId;
 function paint(){const node=document.querySelector('[data-project-deletion]');if(!node)return;const all=new Map(items.map(item=>[item.id,item]));for(const [id,item] of pending)all.set(id,item);
  node.hidden=!all.size&&!error&&!notice&&!next;
  const content=(notice?'<p role="status">'+esc(notice)+'</p>':'')+(error?'<p role="alert">'+esc(error)+'</p><button class="button" data-action="project-deletion-refresh">'+esc(text('retry'))+'</button>':'')+[...all.values()].map(item=>'<article class="panel" data-deletion="'+item.id+'"><h2>'+esc(text('pending'))+'</h2><p class="storage-path">'+esc(item.source)+'</p>'+(item.running||pending.has(item.id)?'<p role="status">'+esc(text('working'))+'</p>':'<button class="button" data-action="project-deletion-resume" data-id="'+item.id+'">'+esc(text('resume'))+'</button>')+'</article>').join('')+(next?'<button class="button" data-action="project-deletion-more">'+esc(text('more'))+'</button>':'');
  if(node.dataset.content!==content){node.dataset.content=content;node.innerHTML=content;}
 }
 async function load(more=false){sync();if(loading)return;loading=true;const token=generation;
  try{const result=await api('/api/projects/delete/pending',{after:more?next:null,limit:20},{adopt:false});if(!current(token))return;const finished=!more&&items.some(item=>item.running&&!result.items.some(value=>value.id===item.id));if(finished){notice=text('completed');await refreshDirectory();if(!current(token))return;}items=more?[...items,...result.items]:result.items;next=result.next;loaded=true;}
  catch(e){if(current(token))error=e.message??text('failed');}finally{if(current(token)){loading=false;paint();}}
 }
 function credentials(item){command={kind:'resume',item,context};showDialog('<form id="project-deletion-resume-form" data-no-draft><h2 id="dialog-title">'+esc(text('resume'))+'</h2><p class="storage-path">'+esc(item.source)+'</p>'+field(text('username'),'<input name="username" autocomplete="username" value="'+esc(item.username??'')+'">')+field(text('password'),'<input name="password" type="password" autocomplete="current-password">')+field(text('recovery'),'<input name="recovery" type="password" autocomplete="off">')+'<div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">'+esc(text('cancel'))+'</button><button type="submit" class="button primary">'+esc(text('resume'))+'</button></div></form>');}
 async function run(item,{resume=false,password='',username='',recovery=''}={}){
  const token=generation;pending.set(item.id,{...item,running:true});error=notice='';paint();
  try{await accessProject(async()=>{
   try{return await api('/api/projects/'+item.projectId+'/storage/delete'+(resume?'/resume':''),resume?{id:item.id,password,username,recovery}:{id:item.id,expectedRoot:item.source},{adopt:false,view:'#/projects'});}
   catch(e){if(resume&&!e.labBookId&&e.projectId===item.projectId)throw {...e,projectId:null};throw e;}
  });if(!current(token))return;notice=text('completed');await refreshDirectory();}
  catch(e){if(current(token)){if(e.name==='AbortError')return;if(resume&&['ACCESS_LOCKED','ACCESS_DENIED','AUTH','DEVICE_UNKNOWN'].includes(e.code)&&!password&&!recovery)credentials(item);else error=e.message??text('failed');}}
  finally{if(current(token)){pending.delete(item.id);await load();paint();}}
 }
 setInterval(()=>{sync();if(visible()&&!pending.size&&items.some(item=>item.running))void load();},1500);
 return {
  view:()=>'<section data-project-deletion hidden></section>',
  bind(){sync();const shown=visible(),entered=shown&&!wasVisible;wasVisible=shown;if(shown){if((entered||!loaded)&&!loading)void load();else paint();}},
  confirm(entry){sync();if(!entry.data||entry.pending)return;const title=state.book.projects.find(p=>p.id===entry.id)?.title??text('pending');command={kind:'delete',context,item:{id:crypto.randomUUID(),projectId:entry.id,source:entry.data.path}};
   showDialog('<form id="project-deletion-form" data-no-draft><h2 id="dialog-title">'+esc(text('confirm',{title}))+'</h2><p class="storage-path">'+esc(entry.data.path)+'</p><p>'+esc(text('effect'))+'</p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">'+esc(text('cancel'))+'</button><button type="submit" class="button danger">'+esc(text('delete'))+'</button></div></form>');
  },
  async action(node){if(!node.dataset.action?.startsWith('project-deletion-'))return false;sync();if(node.dataset.action==='project-deletion-refresh'||node.dataset.action==='project-deletion-more'){error='';await load(node.dataset.action.endsWith('-more'));return true;}const item=items.find(value=>value.id===node.dataset.id);if(item&&!item.running&&!pending.has(item.id)){if(item.password)credentials(item);else await run(item,{resume:true});}return true;},
  async submit(form){if(!['project-deletion-form','project-deletion-resume-form'].includes(form.id))return false;sync();const selected=command;if(!selected||selected.context!==context)return true;command=null;
   const options=form.id.endsWith('-resume-form')?{resume:true,password:form.elements.password.value,username:form.elements.username.value,recovery:form.elements.recovery.value}:{};document.getElementById('dialog').close();
   if(selected.kind==='delete'){const token=generation;await enterProject(null);if(!current(token))return true;state.page='projects';state.project=null;render();}
   await run(selected.item,options);return true;
  }
 };
}
