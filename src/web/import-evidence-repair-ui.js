import {t} from './i18n/index.js';

export function importEvidenceRepairUI({state,call,esc,button}){
 let plan=null,receipt=null,trail=[],generation=0;
 const text=(key,values)=>esc(t('migrationImport',key,values));
 function reset(){plan=receipt=null;trail=[];generation++;}
 function view(){
  if(!plan)return '';
  return '<section class="import-evidence-review" aria-label="'+text('evidenceHeading')+'"><h3>'+text('evidenceHeading')+'</h3><p>'+text('evidenceHelp')+'</p>'+
   (receipt?'<p role="status">'+text('evidenceRepaired',{count:receipt.repaired})+'</p>':'')+'<p>'+text('evidenceMissing',{count:plan.missing})+'</p>'+
   '<ul>'+plan.items.map(item=>'<li><strong>'+esc(item.title)+'</strong><p><a download href="/api/migration/original/'+plan.id+'/'+item.index+'/'+item.file+'?context='+encodeURIComponent(state.storage.contextId)+'">'+esc(item.path)+'</a> · '+text('evidenceBytes',{count:item.bytes})+'</p><p><code>'+esc(item.sha256)+'</code></p><p>'+text(!item.available?'evidenceRemoved':item.existing?'evidencePresent':'evidenceAbsent')+'</p></li>').join('')+'</ul><div class="inline-actions">'+button('evidenceApply','evidence-apply',plan.missing?'':'disabled')+button('previous','evidence-previous',trail.length?'':'disabled')+button('next','evidence-next',plan.next?'':'disabled')+'</div></section>';
 }
 async function action(name,signal){
  if(!name.startsWith('evidence-'))return false;const run=generation;
  const load=async cursor=>{const result=await call('evidenceReview',cursor,signal);if(run===generation)plan=result;};
  if(name==='evidence-start'){trail=[];receipt=null;await load({index:0,file:0});}
  if(name==='evidence-next'&&plan?.next){const previous=plan.start;await load(plan.next);if(run===generation){trail.push(previous);receipt=null;}}
  if(name==='evidence-previous'&&trail.length){await load(trail.at(-1));if(run===generation){trail.pop();receipt=null;}}
  if(name==='evidence-apply'&&plan?.missing){const cursor=plan.start,result=await call('evidenceRepair',{...cursor,review:plan.review},signal);if(run!==generation)return true;receipt=result;await load(cursor);}
  return true;
 }
 return {view,action,reset};
}
