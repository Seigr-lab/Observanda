import {t} from './i18n/index.js';
import {recordConflictLabel} from './record-recovery-messages.js';
const text=(key,args)=>t('recordDraftReview',key,args);
export function recordDraftReviewUI(options){
 const {api,esc,onSaved}=options;
 let activeClose=null;
 const open=async(header,{signal}={})=>{
  const dialog=document.createElement('dialog');dialog.className='record-recovery record-draft-review';dialog.setAttribute('aria-labelledby','record-draft-review-title');document.body.append(dialog);
  const before=document.activeElement;let plan=null,page=null,position=0,item=null,busy=false,finished=false,resolve,editController=null;
  const result=new Promise(done=>{resolve=done;}),offsets={base:0,mine:0,stored:0},values={};
  const target=()=>({id:plan.id,workspaceId:plan.workspaceId,expectedRevision:plan.revision});
  const request=(operation,data={})=>api('/api/research/drafts/review/'+operation,{...target(),...data},{adopt:false,signal});
  const button=(key,action,disabled=false)=>'<button type="button" class="button" data-review="'+action+'"'+(disabled?' disabled':'')+'>'+esc(text(key))+'</button>';
  const close=value=>{if(finished)return;finished=true;activeClose=null;editController?.abort();signal?.removeEventListener('abort',abort);dialog.close();dialog.remove();if(before?.isConnected)before.focus({preventScroll:true});resolve(value);};
  const abort=()=>close(false);
  activeClose=abort;
  function render(error=''){
   dialog.innerHTML='<h2 id="record-draft-review-title" tabindex="-1">'+esc(plan?.title??text('title'))+'</h2><p>'+esc(text('description'))+'</p><p role="status">'+esc(plan?text('progress',{decided:plan.decided,total:plan.count}):text('loading'))+'</p>'+
    (plan?.removedRecord?'<p>'+esc(text('removedRecord'))+'</p>':'')+
    (item?'<h3>'+(item.path.length?item.path.map(part=>esc(recordConflictLabel(part,(key,args)=>t('recordRecovery',key,args)))).join(' / '):esc(text('wholeRecord')))+'</h3><div class="record-conflict-versions">'+['mine','stored','base'].map(version=>{
     const value=values[version];return '<section><h4>'+esc(text(version))+'</h4><pre tabindex="0">'+esc(value?.missing?text('missing'):value?.text??'')+'</pre><div class="inline-actions">'+button('previousPart','value-'+version+'-previous',busy||!offsets[version])+button('nextPart','value-'+version+'-next',busy||value?.next==null)+'</div>'+(version==='base'?'':button(item.choice===version?'chosen':'choose','choose-'+version,busy))+'</section>';
    }).join('')+'</div><nav class="inline-actions" aria-label="'+esc(text('navigation'))+'">'+button('previous','previous',busy||position===0)+button('next','next',busy||position+1>=plan.count)+'<span>'+esc(text('position',{current:position+1,total:plan.count}))+'</span></nav>':plan?'<p>'+esc(text(plan.newRecord?'newRecord':'noConflicts'))+'</p>':'')+
    '<p role="alert">'+esc(error)+'</p><div class="dialog-actions">'+button('close','close',busy)+button('edit','edit',busy||!plan||!!plan.saved)+button('save','save',busy||!plan||plan.decided!==plan.count)+'</div>';
  }
  async function load(index){
   position=index;page=await request('page',{offset:index});plan={...plan,...page};item=page.items[0]??null;
   for(const version of ['base','mine','stored']){offsets[version]=0;values[version]=item?await request('value',{position,version,offset:0}):null;}
  }
  async function perform(operation){
   if(busy||finished)return;busy=true;render();
   try{await operation();if(!finished){busy=false;render();dialog.querySelector('h2').focus();}}
   catch(error){if(!finished){busy=false;render(error.message??text('failed'));}}
  }
  dialog.oncancel=event=>{event.preventDefault();if(!busy)close(false);};
  dialog.onclick=event=>{
   const action=event.target.closest('[data-review]')?.dataset.review;if(!action||busy)return;
   if(action==='close'){close(false);return;}
   void perform(async()=>{
    if(action==='next'||action==='previous')await load(position+(action==='next'?1:-1));
    else if(action.startsWith('choose-')){plan=await request('choose',{position,version:action.slice(7)});await load(position);}
    else if(action.startsWith('value-')){
     const [,version,direction]=action.split('-');offsets[version]=direction==='next'?values[version].next:Math.max(0,offsets[version]-4096);values[version]=await request('value',{position,version,offset:offsets[version]});
    }else if(action==='edit'){
     const editing=new AbortController();editController=editing;const {editRecordCheckpoint}=await import('./record-draft-edit-ui.js');if(finished||editing.signal.aborted)return;
     try{await editRecordCheckpoint(options,{plan,signal:editing.signal});}finally{if(editController===editing)editController=null;}if(finished)return;
     plan=await api('/api/research/drafts/review/prepare',plan.source,{adopt:false,signal});await load(0);
    }else if(action==='save'){const saved=await request('apply');if(!finished){close(true);await onSaved(saved);}}
   });
  };
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){close(false);return result;}
  render();dialog.showModal();
  void perform(async()=>{plan=header.reviewPlan??await api('/api/research/drafts/review/prepare',{id:header.draft.id,workspaceId:header.draft.workspaceId,expectedRevision:header.revision},{adopt:false,signal});await load(0);});
  return result;
 };
 open.close=()=>activeClose?.();return open;
}
