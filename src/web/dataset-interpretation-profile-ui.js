import {profileText,reviewLocations} from './dataset-schema-group-ui.js';
import {materialSourcePicker} from './material-source-picker.js';
import {materialReference} from './material-reference.js';
import {t} from './i18n/index.js';

const kinds=['string','number','boolean','null','absent','object','array'];

export function datasetInterpretationProfileUI({call,frame,esc,field,guard,owner,inspect,watchJob}){
 let controller,picker;
 const clean=()=>{controller?.abort();picker?.dispose();controller=null;picker=null;};
 const label=key=>esc(profileText(key));
 const button=(key,action,disabled=false)=>'<button type="button" class="button" data-profile="'+action+'" '+(disabled?'disabled':'')+'>'+label(key)+'</button>';
 const sourceName=identity=>identity.kind==='header'?identity.text:identity.kind==='position'?String(identity.index+1):identity.source+' '+identity.path;
 function view(title,body){
  clean();frame(title,'<section data-profile-panel>'+body+'<p role="status" data-status></p></section>');controller=new AbortController();
  const root=document.querySelector('[data-profile-panel]'),signal=controller.signal,status=root.querySelector('[data-status]');
  const current=()=>{guard();if(!root.isConnected||signal.aborted)throw new DOMException('Closed','AbortError');};
  function handle(action){
   root.addEventListener('click',async event=>{
    const target=event.target.closest('button[data-profile]');if(!target||target.disabled||root.dataset.busy==='true')return;
    root.dataset.busy='true';root.setAttribute('aria-busy','true');
    try{await action(target.dataset.profile,target);current();}
    catch(error){if(root.isConnected&&!signal.aborted)status.textContent=error.message;}
    finally{delete root.dataset.busy;root.removeAttribute('aria-busy');}
   },{signal});
  }
  return {root,signal,status,current,handle,request:(name,data)=>call(name,data,{signal,adopt:false})};
 }
 async function author(template,priorRef=null){
  let base,offset=0,next=null,signature=null,sequence=0,edit=0,revisionPage,proposal;
  const rules=new Map();
  const ui=view(profileText(priorRef?'revise':'create'),
   field(label('name'),'<input data-name required maxlength="300">')+
   '<div data-columns></div><div class="inline-actions">'+button('previous','previous',true)+'<span data-range></span>'+button('next','next',true)+'</div>'+
   '<div class="inline-actions">'+button('review','review')+button('save','save',true)+'</div><div data-differences></div>');
  const get=selector=>ui.root.querySelector(selector),input=get('[data-name]');
  const id=priorRef?.id??crypto.randomUUID();
  if(priorRef){
   base=await ui.request('dataset-profile-read',{recordId:owner(),ref:priorRef});ui.current();input.value=base.title;
   template=base.template;for(const rule of base.rules)rules.set(rule.index,rule);
  }
  const invalidate=()=>{edit++;signature=null;get('[data-profile="save"]').disabled=true;get('[data-differences]').replaceChildren();};
  const capture=()=>{
   for(const row of ui.root.querySelectorAll('[data-rule]')){
    const index=Number(row.dataset.rule),aliases=row.querySelector('[data-aliases]')?.value.split(/\r?\n/).filter(value=>value.length)??[];
    const tokens=row.querySelector('[data-tokens]').value.split(/\r?\n/).filter(value=>value.length);
    const required=row.querySelector('[data-required]').checked,at=row.querySelector('[data-position]')?.checked?index:null;
    const selected=[...row.querySelectorAll('[data-kind]:checked')].map(control=>control.dataset.kind);
    if(!selected.length)throw Error(profileText('chooseKinds'));
    if(required&&at===null&&!aliases.length&&!tokens.length&&selected.length===kinds.length)rules.delete(index);
    else rules.set(index,{index,required,at,aliases,kinds:selected.length===kinds.length?null:selected,...(tokens.length?{tokens}:{})});
   }
  };
  async function columns(at){
   const requested=++sequence;
   const page=await ui.request('dataset-profile-template',{recordId:owner(),ref:template,offset:at,limit:16});
   ui.current();if(sequence!==requested)return;offset=at;next=page.next;
   get('[data-columns]').innerHTML=page.items.map(item=>{
    const rule=rules.get(item.index),header=item.identity.kind==='header';
    return '<details data-rule="'+item.index+'"><summary>'+esc(String(item.index+1)+' · '+item.name)+' <small>'+esc(item.unit)+'</small></summary>'+
     '<p>'+label('exactName')+' <code>'+esc(sourceName(item.identity))+'</code></p>'+
     '<label><input type="checkbox" data-required '+(rule?.required===false?'':'checked')+'> '+label('required')+'</label>'+
     (header?field(label('aliases'),'<textarea data-aliases rows="2">'+esc((rule?.aliases??[]).join('\n'))+'</textarea>')+
      '<label><input type="checkbox" data-position '+(rule?.at===item.index?'checked':'')+'> '+label('position')+'</label>':'')+
     field(label('tokens'),'<textarea data-tokens rows="2">'+esc((rule?.tokens??[]).join('\n'))+'</textarea>')+
     '<fieldset><legend>'+label('kinds')+'</legend><div class="inline-actions">'+kinds.map(kind=>
      '<label><input type="checkbox" data-kind="'+kind+'" '+(!rule?.kinds||rule.kinds.includes(kind)?'checked':'')+'> '+label('kind-'+kind)+'</label>').join('')+
     '</div></fieldset></details>';
   }).join('');
   get('[data-range]').textContent=profileText('columnWindow',{first:at+1,last:at+page.items.length,total:page.total});
   get('[data-profile="previous"]').disabled=!at;get('[data-profile="next"]').disabled=next===null;
  }
  function changes(page){
   revisionPage=page;
   get('[data-differences]').innerHTML='<h3>'+label('changes')+'</h3><p>'+esc(profileText('differenceCount',{count:page.total}))+'</p>'+
    (page.items.length?'<table><thead><tr><th>'+label('column')+'</th><th>'+label('before')+'</th><th>'+label('after')+'</th></tr></thead><tbody>'+
     page.items.map(item=>'<tr><td>'+esc([item.index===undefined?null:item.index+1,item.key??profileText('change-'+item.kind)].filter(v=>v!==null).join(' · '))+'</td>'+
      '<td><code>'+esc(item.before?.text??'')+'</code></td><td><code>'+esc(item.after?.text??'')+'</code></td></tr>').join('')+'</tbody></table>':'')+
    (page.next!==null?button('next','more-changes'):'');
  }
  ui.root.addEventListener('input',invalidate,{signal:ui.signal});
  ui.root.addEventListener('change',invalidate,{signal:ui.signal});
  ui.handle(async action=>{
   capture();
   if(action==='previous'||action==='next'){await columns(action==='next'?next:Math.max(0,offset-16));return;}
   if(action==='review'||action==='more-changes'){
    if(!input.reportValidity())return;
    proposal={id,recordId:base?.recordId??owner(),expectedRevision:priorRef?.revision??null,title:input.value.trim(),template,rules:[...rules.values()].sort((a,b)=>a.index-b.index)};
    const expectedEdit=edit,result=await ui.request('dataset-profile-revision',{command:proposal,offset:action==='more-changes'?revisionPage.next:0,limit:16});
    ui.current();if(edit!==expectedEdit)return;signature=result.review;changes(result.changes);ui.status.textContent=profileText('signature')+' '+result.signature;
    get('[data-profile="save"]').disabled=false;return;
   }
   if(action==='save'&&signature){const result=await ui.request('dataset-profile-save',{command:proposal,review:signature});ui.current();await inspect(result.ref);}
  });
  await columns(0);ui.current();input.focus();
 }

 async function library(artifact){
  let next,records=[];
  const ui=view(profileText('apply'),field(label('name'),'<input data-query type="search" maxlength="200">')+
   '<div class="inline-actions">'+button('find','find')+button('next','more',true)+'</div><div data-results></div>');
  async function list(after){
   const page=await ui.request('dataset-profile-list',{recordId:owner(),query:ui.root.querySelector('[data-query]').value,after});ui.current();
   next=page.next;records=page.items;
   ui.root.querySelector('[data-results]').innerHTML=records.map((item,i)=>'<button class="button" type="button" data-profile="choose" data-index="'+i+'">'+esc(item.title)+'</button>').join('');
   ui.root.querySelector('[data-profile="more"]').disabled=next===null;ui.status.textContent=records.length?'':profileText('noProfiles');
  }
  ui.handle(async(action,target)=>{if(action==='choose')await batch(records[Number(target.dataset.index)].ref,artifact);else await list(action==='more'?next:null);});
  await list(null);
 }
 async function batch(profile,artifact=null,intake=null){
  const recordId=intake?.recordId??owner();
  const completed=[],details=new Map(),ui=view(profileText('apply'),'<div data-picker><input type="hidden" data-value></div><div class="inline-actions">'+button('checkFiles','check')+button('keepResults','keep',true)+'</div><div data-report></div>');
  const result=ui.root.querySelector('[data-report]'),keep=ui.root.querySelector('[data-profile="keep"]');let start=0,generation=0;
  if(!artifact&&!intake){
   picker=materialSourcePicker({root:ui.root.querySelector('[data-picker]'),call,esc,field,label:profileText('files'),id:'interpretation-originals',recordId:owner(),kind:'artifact',multiple:true,guard,onBusy:busy=>{ui.root.querySelector('[data-profile="check"]').disabled=busy;}});
   await picker.ready;ui.current();
  }
  function remember(index,report){
   details.delete(index);details.set(index,report);
   if(details.size>16)details.delete(details.keys().next().value);
  }
  function detailButton(action,key,index,offset){
   return '<button type="button" class="button" data-profile="'+action+'" data-index="'+index+'" data-offset="'+offset+'">'+label(key)+'</button>';
  }
  function pages(name,page,index){
   if(!page.offset&&page.next===null)return '';
   return '<div class="inline-actions">'+(page.offset?detailButton(name,'previous',index,Math.max(0,page.offset-32)):'')+
    '<span>'+esc(String(page.offset+1)+'–'+(page.offset+page.items.length)+' / '+page.total)+'</span>'+
    (page.next===null?'':detailButton(name,'next',index,page.next))+'</div>';
  }
  function describe(index,data){
   const values=data.issues.total?'issues':'examples';
   const location=column=>{
    if(column.identity.kind==='pointer')return column.identity.path;
    const {line,column:physical}=column.locator??{};
    return [line===undefined?'':profileText('line',{line}),physical===undefined?'':profileText('column')+' '+(physical+1)].filter(Boolean).join(' · ');
   };
   return '<p>'+esc(profileText('mappingStatus',{status:data.sameMapping?profileText('same'):profileText('changed')}))+'</p>'+
    '<table><thead><tr><th>'+label('exactName')+'</th><th>'+label('match')+'</th><th>'+label('location')+'</th></tr></thead><tbody>'+data.columns.items.map(column=>
    '<tr><td>'+esc(sourceName(column.identity))+'</td><td>'+label('match-'+column.status)+'</td><td>'+esc(location(column))+'</td></tr>').join('')+'</tbody></table>'+
    pages('columns',data.columns,index)+reviewLocations(data[values].items,{esc})+pages(values,data[values],index);
  }
  function show(){
   const opened=new Set([...result.querySelectorAll('details[open]')].map(item=>Number(item.dataset.file)));
   result.innerHTML='<div class="inline-actions">'+button('previous','prev-files',start===0)+button('next','next-files',start+16>=completed.length)+'</div>'+
    completed.slice(start,start+16).map((entry,i)=>{
     const index=start+i,file=entry.file,data=details.get(index);
     return '<details data-file="'+index+'"'+(opened.has(index)?' open':'')+'><summary>'+esc(file.title??file.id)+' · '+
      esc(entry.error??profileText('fileResult',{rows:entry.rowCount,issues:entry.failures}))+'</summary>'+
      (data?describe(index,data):entry.error?'':detailButton('detail','review',index,0))+
      (entry.job?detailButton('job','openJob',index,0):'')+'</details>';
    }).join('');
  }
  async function* files(){
   if(intake){yield* intake.files;return;}
   if(artifact){yield artifact;return;}
   const {recordId,kind,selection,count}=picker.snapshot();
   if(!count)throw Error(profileText('checkSelection'));
   let offset=0;
   do{const page=await ui.request('selection-page',{recordId,kind,selection,offset,limit:32});ui.current();yield* page.items;offset=page.next;}while(offset!==null);
  }
  async function* batches(){
   let group=[];
   for await(const file of files()){group.push(file);if(group.length===8){yield group;group=[];}}
   if(group.length)yield group;
  }
  const reset=()=>{generation++;completed.length=0;details.clear();keep.disabled=true;result.replaceChildren();start=0;};
  ui.root.addEventListener('input',event=>{if(event.target.matches('[data-picker] [data-value]')){reset();ui.status.textContent='';}},{signal:ui.signal});
  ui.handle(async(action,target)=>{
   if(action==='prev-files'||action==='next-files'){start+=action==='prev-files'?-16:16;show();return;}
   if(action==='job'){await watchJob(completed[Number(target.dataset.index)].job);return;}
   if(['detail','columns','issues','examples'].includes(action)){
    const requested=generation,index=Number(target.dataset.index),page={},prior=details.get(index);
    for(const name of ['columns','issues','examples'])page[name]={offset:action===name?Number(target.dataset.offset):prior?.[name].offset??0,limit:32};
    const report=await ui.request('dataset-profile-review',{recordId,profile,artifact:materialReference(completed[index].file),page});
    ui.current();if(requested!==generation)return;remember(index,report);show();return;
   }
   if(action==='check'){
    reset();const requested=generation;
    for await(const group of batches()){
     if(requested!==generation)return;
     const first=group[0];ui.status.textContent=profileText('checkingFile',{file:first.title??first.id});
     const {items}=await ui.request('dataset-profile-review-batch',{recordId,profile,files:group.map((file,i)=>({ref:materialReference(file),details:completed.length+i<16}))});
     ui.current();if(requested!==generation)return;
     for(const [index,{report,code}] of items.entries()){
      const file=group[index];
      if(!report){completed.push({file,error:t('errors',code)});continue;}
      if(report.columns)remember(completed.length,report);
      completed.push({file,rowCount:report.rowCount,failures:report.failures,review:report.review,jobId:crypto.randomUUID()});
     }
    }
    if(requested!==generation)return;
    show();keep.disabled=!completed.some(item=>item.review);ui.status.textContent=profileText(completed.length===1?'checkedFileOne':'checkedFiles',{count:completed.length});
   }
   if(action==='keep'){
    const requested=generation;
    for(const [index,entry] of completed.entries()){
     if(requested!==generation)return;
     if(entry.job||!entry.review)continue;
     const title=(entry.file.title??entry.file.id).slice(0,300);
     const {job}=await ui.request('dataset',{jobId:entry.jobId,recordId,title,artifact:materialReference(entry.file),sourceMapping:{format:'interpretation-profile'},interpretationProfile:{ref:profile,review:entry.review}});
     ui.current();if(requested!==generation)return;entry.job=job;
     if(index>=start&&index<start+16)show();
    }
    const count=completed.filter(entry=>entry.job).length;keep.disabled=true;ui.status.textContent=profileText(count===1?'queuedOne':'queued',{count});
   }
  });
 }
 return {author,library,batch,clean};
}
