import './i18n/catalogues/evidenceCorrections.js';
import './i18n/catalogues/evidenceIntake.js';
import {t} from './i18n/index.js';
import {researchTargetPicker} from './research-target-picker.js';
import {evidencePurposes} from './evidence-files.js';
const tr=(key,values)=>t('evidenceCorrections',key,values);
export function evidenceCorrectionsUI({state,api,call,frame,esc,field,button,guard,owner,inspect,notify,readOnly}){
 let source=null,status=null,intent=null,review=null,busy=false,serial=0;
 const control=(key,action,extra='')=>button(esc(tr(key)),'correction-'+action,extra);
 const picker=researchTargetPicker({state,api,esc,field,showDialog:()=>{},excludeId:owner});
 function stop(){serial++;picker.stop();source=null;status=null;intent=null;review=null;}
 document.getElementById('dialog')?.addEventListener('close',stop);
 function form(){
  const m=intent.metadata,retired=Boolean(status.retired),action=intent.action;
  frame(tr('title'),'<p>'+esc(tr('help'))+'</p><strong>'+esc(source.title)+'</strong>'+field(tr('action'),'<select id="correction-action">'+(retired?['restore']:['metadata','retire','reassign']).map(value=>'<option value="'+value+'" '+(action===value?'selected':'')+'>'+esc(tr(value))+'</option>').join('')+'</select>')+
   '<div data-correction-metadata '+(action==='metadata'?'':'hidden')+'>'+field(tr('name'),'<input id="correction-title" maxlength="300" value="'+esc(m.title)+'">')+field(tr('provenance'),'<textarea id="correction-provenance" maxlength="10000">'+esc(m.provenance)+'</textarea>')+field(tr('path'),'<input id="correction-path" maxlength="4096" value="'+esc(m.sourcePath)+'">')+field(tr('purpose'),'<select id="correction-purpose"><option value="">'+esc(tr('unspecified'))+'</option>'+evidencePurposes.map(p=>'<option value="'+p+'" '+(p===m.sourcePurpose?'selected':'')+'>'+esc(t('evidenceIntake','purpose-'+p))+'</option>').join('')+'</select>')+'</div>'+
   '<div data-correction-replacement '+(action==='reassign'?'':'hidden')+'><p data-correction-target>'+esc(intent.replacement?.title??tr('none'))+'</p>'+control('choose','choose')+'<div data-correction-picker></div></div>'+field(tr('reason'),'<textarea id="correction-reason" required maxlength="2000">'+esc(intent.reason)+'</textarea>')+control('review','review'));
  document.getElementById('correction-action').addEventListener('change',()=>{capture();form();});
 }
 function capture(){
  const value=id=>document.getElementById('correction-'+id)?.value??'';
  intent.action=value('action');intent.reason=value('reason');intent.metadata={title:value('title'),provenance:value('provenance'),sourcePath:value('path'),sourcePurpose:value('purpose')};
 }
 async function open(ref){
  guard();stop();const version=serial;const [doc,next]=await Promise.all([call('read',{ref}),call('correction-status',{ref})]);guard();if(version!==serial)return;
  if(doc.recordId!==owner()||readOnly())throw Error(tr('changed'));
  source={...doc,ref};status=next;
  if(!next.retired&&next.current?.revision!==ref.revision){frame(tr('title'),'<p>'+esc(tr('older'))+'</p>'+control('current','current'));return;}
  intent={action:next.retired?'restore':'metadata',reason:'',replacement:null,metadata:{title:doc.title,provenance:doc.content.provenance??'',sourcePath:doc.content.sourcePath??'',sourcePurpose:doc.content.sourcePurpose??''}};form();
 }
 async function history(cursor=null){
  stop();const version=serial,result=await call('correction-history',{recordId:owner(),cursor});guard();if(version!==serial)return;
  frame(tr('history'),result.items.length?'<ul class="material-list">'+result.items.map(item=>'<li><div><strong>'+esc(item.title)+'</strong><p>'+esc(tr(item.action))+' · '+esc(item.createdAt)+'</p><p>'+esc(item.reason)+'</p>'+control('inspect','inspect','data-ref="'+esc(JSON.stringify(item.ref))+'"')+'</div></li>').join('')+'</ul>'+(result.next?control('historyMore','history','data-cursor="'+esc(result.next)+'"'):''):'<p>'+esc(tr('historyEmpty'))+'</p>');
 }
 async function action(act,el){
  if(!act.startsWith('correction-'))return false;if(readOnly())return true;guard();if(busy)return true;
  busy=true;el.disabled=true;const version=serial;
  try{
  if(act==='correction-open')return await open(JSON.parse(el.dataset.ref)),true;
  if(act==='correction-history')return await history(el.dataset.cursor??null),true;
  if(act==='correction-inspect')return await inspect(JSON.parse(el.dataset.ref)),true;
  if(act==='correction-current')return await inspect(status.current),true;
  if(act==='correction-back'){form();return true;}
  if(act==='correction-choose'){
   capture();const host=document.querySelector('[data-correction-picker]');picker.open({root:host,recordsOnly:true,onCancel:()=>{picker.stop();host.replaceChildren();},onChoose:item=>{guard();intent.replacement={id:item.id,title:item.title};document.querySelector('[data-correction-target]').textContent=item.title;picker.stop();host.replaceChildren();}});return true;
  }
   if(act==='correction-review'){
    capture();if(!intent.reason.trim()||intent.action==='reassign'&&!intent.replacement)throw Error(tr('required'));
    const command={recordId:owner(),ref:source.ref,action:intent.action,reason:intent.reason,metadata:intent.action==='metadata'?intent.metadata:null,replacementRecordId:intent.action==='reassign'?intent.replacement.id:null};
    const result=await call('correction-preview',command);guard();if(version!==serial)return true;review=result;
    frame(tr('review'),'<p>'+esc(tr('reviewHelp'))+'</p><dl>'+[['action',tr(command.action)],['name',review.title],['revision',command.ref.revision],['size',review.file.size],['hash',review.file.sha256],['recordedReason',command.reason],...(review.replacement?[['replacement',review.replacement.title]]:[]),...(command.metadata?Object.entries(command.metadata).map(([key,value])=>[{title:'name',provenance:'provenance',sourcePath:'path',sourcePurpose:'purpose'}[key],value]):[])].map(([key,value])=>'<dt>'+esc(tr(key))+'</dt><dd class="material-hash">'+esc(value)+'</dd>').join('')+'</dl>'+control('back','back')+control('confirm','apply'));
   }else if(act==='correction-apply'){
    if(!review)throw Error(tr('changed'));const result=await call('correction-apply',{command:review.command,review:review.review});guard();if(version!==serial)return true;await inspect(result.after?{kind:result.after.kind,id:result.after.id,revision:result.after.revision}:review.command.ref);notify(tr('saved'));
   }
  }finally{busy=false;if(el.isConnected)el.disabled=false;}
  return true;
 }
 async function controls(doc,ref){
  if(doc.kind!=='artifact')return '';const value=await call('correction-status',{ref});guard();
  return (value.retired?'<p role="status">'+esc(tr('removed'))+'</p>':'')+(doc.recordId===owner()&&!readOnly()?control('open','open','data-ref="'+esc(JSON.stringify(ref))+'"'):'');
 }
 return {action,controls,isBusy:()=>busy,stop};
}
