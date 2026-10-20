import {researchId} from './research-reference.js';
import {t} from './i18n/index.js';
const tr=(key,args)=>t('localIntake',key,args);
export function runReadinessUI({call,frame,esc,field,guard,back,notify}){
 let view=null,generation=0,draft={},page={items:[],next:null},cursor=null,request=null,receiptCursor=null,receiptBack=[],websitePage={items:[],next:null},websiteAfter=null,websiteBack=[],websiteLoading=false,websiteError=false;
 const stop=()=>{generation++;};
 const button=(key,action,extra='')=>'<button type="button" class="button" data-action="material-readiness-'+action+'" '+extra+'>'+esc(tr(key))+'</button>';
 const pair=(key,value)=>value===undefined?'':'<dt>'+esc(tr(key))+'</dt><dd style="overflow-wrap:anywhere">'+esc(value)+'</dd>';
 const input=(key,max=500)=>field(tr(key),'<input id="readiness-'+key+'" data-receipt-field="'+key+'" required maxlength="'+max+'" value="'+esc(draft[key]??'')+'">');
 const select=(key,options,value)=>field(tr(key),'<select id="readiness-'+key+'" data-receipt-field="'+key+'">'+options.map(([id,label])=>'<option value="'+esc(id)+'"'+(String(value??'')===String(id)?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select>');
 const capture=()=>{for(const el of document.querySelectorAll('[data-receipt-field]'))draft[el.dataset.receiptField]=el.value;const selected=websitePage.items.find(item=>(item.id??'')===(draft.website??''));if(selected)draft.websiteName=selected.name;};
 const websiteButton=(key,action,disabled=false)=>'<button type="button" class="button" data-action="material-readiness-websites-'+action+'"'+(disabled?' disabled':'')+'>'+esc(t('websiteSites',key))+'</button>';
 function websiteChoices(){const items=[...websitePage.items],selected=draft.website??'';if(!items.some(item=>(item.id??'')===selected))items.unshift({id:selected||null,name:draft.websiteName??tr('workspaceWebsite')});return items.map(item=>[item.id??'',item.name||tr('workspaceWebsite')]);}
 function websiteControls(){return '<div class="inline-actions" data-receipt-websites>'+websiteButton('directoryPrevious','previous',websiteLoading||!websiteBack.length)+websiteButton('directoryNext','next',websiteLoading||!websitePage.next)+(websiteError?websiteButton('directoryRetry','retry'):'')+'</div>'+(websiteLoading||websiteError?'<p role="'+(websiteError?'alert':'status')+'">'+esc(t('websiteSites',websiteError?'directoryFailed':'directoryLoading'))+'</p>':'');}
 function detail(receipt){
  const tool=receipt.tool??receipt.verification,source=receipt.source;
  return '<details><summary>'+esc(tr('receiptDetails'))+'</summary><dl>'+pair('recordedAt',receipt.recordedAt)+pair('savedRevision',receipt.recordRevision)+pair('evidenceRevision',receipt.evidenceRevision)+pair('sourceRevision',source?.revision)+pair('sourceSha256',source?.sha256??receipt.sourceSha256)+
   (tool?pair('tool',tool.name??tool.tool)+pair('toolVersion',tool.version)+pair('toolSha256',tool.sha256):'')+
   (receipt.git?pair('repository',receipt.git.repository)+pair('commit',receipt.git.commit):'')+
   (receipt.publication?pair('website',receipt.publication.websiteName??tr('workspaceWebsite'))+pair('release',receipt.publication.releaseId)+pair('publicationJob',receipt.publication.jobId):'')+pair('pin',receipt.pin)+'</dl>'+(receipt.publication?'<p>'+esc(tr('preparedOnly'))+'</p>':'')+'</details>';
 }
 async function home({cursor:nextCursor=null,previous=[],criteriaOffset=0,expectedRevision}={}){
  const at=++generation,result=await call('readiness',{receiptCursor:nextCursor,criteriaOffset,...(expectedRevision?{expectedRevision}:{})});guard();if(at!==generation)return;view=result;receiptCursor=nextCursor;receiptBack=previous;
  frame(tr('readiness'),'<p>'+esc(tr('readinessIntro'))+'</p><ul><li>'+esc(tr('artifacts',{count:view.counts.artifacts}))+'</li><li>'+esc(tr('analysisCount',{count:view.counts.analyses,stale:view.counts.staleAnalyses}))+'</li><li>'+esc(tr('reviewCount',{count:view.counts.pendingReviews,changed:view.counts.changedReviews}))+'</li></ul>'+
   '<section data-readiness-criteria><h3>'+esc(tr('unresolved'))+'</h3>'+(view.unresolved.length?'<ul>'+view.unresolved.map(c=>'<li>'+esc(c.label)+'</li>').join('')+'</ul>':'<p>'+esc(tr('noCriteria'))+'</p>')+(view.unresolvedPage?'<p>'+esc(t('attempts','nestedRange',{first:view.unresolvedPage.total?view.unresolvedPage.offset+1:0,last:view.unresolvedPage.offset+view.unresolved.length,total:view.unresolvedPage.total}))+'</p><div class="inline-actions"><button type="button" class="button" data-action="material-readiness-criteria-previous"'+(!view.unresolvedPage.offset?' disabled':'')+'>'+esc(t('attempts','previousCriteria'))+'</button><button type="button" class="button" data-action="material-readiness-criteria-next"'+(view.unresolvedPage.next===null?' disabled':'')+'>'+esc(t('attempts','nextCriteria'))+'</button></div>':'')+'</section>'+
   (view.missing.length?'<p role="status">'+esc(tr('missing',{kinds:view.missing.map(k=>tr(k)).join(', ')}))+'</p>':'')+
   '<section data-receipt-history><h3>'+esc(tr('receipts'))+'</h3><p data-receipt-status role="status" tabindex="-1">'+esc(tr('receiptPage',{count:view.receipts.length,total:view.receiptPage.total}))+'</p>'+'<div class="inline-actions">'+(receiptBack.length?button('previousReceipts','receipts-previous')+button('latestReceipts','receipts-latest'):'')+(view.receiptPage.next?button('olderReceipts','receipts-more'):'')+'</div>'+button('addReceipt','new')+(view.receipts.length?'<ul>'+view.receipts.map(r=>'<li>'+esc(tr(r.kind))+' · '+esc(tr(r.current?'current':'earlier'))+'<p>'+esc(r.statement??r.verification?.statement??r.publication?.releaseId??'')+'</p>'+(r.evidenceChanged?'<p>'+esc(tr(r.evidenceRevision?'changedEvidence':'unboundEvidence'))+'</p>':'')+(r.declared?'<small>'+esc(tr('declared'))+'</small>':'')+detail(r)+'</li>').join('')+'</ul>':'<p>'+esc(tr('noReceipts'))+'</p>')+
   '</section><details><summary>'+esc(tr('policy'))+'</summary><p>'+esc(tr('policyHelp'))+'</p>'+['validation','publication','git'].map(k=>'<label><input type="checkbox" data-receipt-required="'+k+'"'+(view.policy.required.includes(k)?' checked':'')+'> '+esc(tr(k))+'</label>').join('')+button('savePolicy','policy')+'</details>',button('backEvidence','back'));
 }
 function form({loading=false}={}){
  frame(tr('addReceipt'),select('kind',['validation','publication','git'].map(k=>[k,tr(k)]),draft.kind)+(draft.kind==='publication'?
   select('website',websiteChoices(),draft.website)+websiteControls()+'<p>'+esc(tr('preparedOnly'))+'</p>'+
   (loading?'<p role="status">'+esc(tr('loadingEditions'))+'</p>':page.items.length?select('edition',page.items.map(s=>[s.jobId,s.createdAt+' · '+s.releaseId.slice(0,12)+' · '+tr(s.current?'current':'earlier')]),draft.edition):'<p>'+esc(tr('noEditions'))+'</p>')+
   (cursor?button('latestEditions','latest'):'')+(page.next?button('olderEditions','more'):''):
   input('sourceRevision')+input('sourceSha256',64)+field(tr('statement'),'<textarea id="readiness-statement" data-receipt-field="statement" required maxlength="2000">'+esc(draft.statement??'')+'</textarea>')+(draft.kind==='git'?input('repository')+input('commit',64):input('tool',200)+input('toolVersion',200)+input('toolSha256',64))+'<p>'+esc(tr('declared'))+'</p>'),
   button('readiness','home')+button('saveReceipt','save',loading||websiteLoading||draft.kind==='publication'&&!page.items.find(s=>s.jobId===draft.edition)?.current?'disabled':''));
  document.getElementById('readiness-kind').onchange=()=>{capture();cursor=null;void changeKind().catch(error=>notify(error.message,true));};
  if(draft.kind==='publication'){
   document.getElementById('readiness-website').disabled=websiteLoading;
   document.getElementById('readiness-website').onchange=()=>{capture();cursor=null;draft.edition='';void editions().catch(error=>notify(error.message,true));};
   const edition=document.getElementById('readiness-edition');if(edition)edition.onchange=()=>{capture();form();};
  }
 }
 async function websites(after=null,previous=[]){
  const at=++generation;websiteAfter=after;websiteBack=previous;websiteLoading=true;websiteError=false;form();
  try{const result=await call('receipt-websites',{after,limit:20,expectedRevision:view.revision});guard();if(at!==generation)return false;
   if(!Array.isArray(result.items)||result.items.length>20||result.items.some(item=>!item||item.id!==null&&!researchId(item.id)||typeof item.name!=='string'||after&&item.id===null)||new Set(result.items.map(item=>item.id)).size!==result.items.length||result.next!==null&&!researchId(result.next))throw Error(t('websiteSites','directoryFailed'));
   websitePage=result;websiteLoading=false;const selected=result.items.find(item=>(item.id??'')===(draft.website??''));if(selected)draft.websiteName=selected.name;form();return true;
  }catch(error){if(at!==generation)return false;websiteLoading=false;websiteError=true;form();return false;}
 }
 async function editions(){
  const at=++generation;form({loading:true});
  try{const result=await call('receipt-editions',{websiteId:draft.website||null,cursor,expectedRevision:view.revision});guard();if(at!==generation)return;page=result;if(!page.items.some(s=>s.jobId===draft.edition))draft.edition=page.items.find(s=>s.current)?.jobId??page.items[0]?.jobId??'';form();}
  catch(error){if(at!==generation)return;page={items:[],next:null};form();throw error;}
 }
 async function changeKind(){if(draft.kind==='publication'){page={items:[],next:null};if(await websites())await editions();}else{stop();websiteLoading=false;form();}}
 async function action(control){
  guard();control.disabled=true;const action=control.dataset.action?.replace('material-readiness-',''),at=generation;
  try{
   if(action==='back'){stop();await back();}
   if(action==='home')await home();
   if(action==='receipts-more'||action==='receipts-previous'||action==='receipts-latest'){const previous=action==='receipts-more'?[...receiptBack,receiptCursor]:action==='receipts-previous'?receiptBack.slice(0,-1):[];await home({cursor:action==='receipts-more'?view.receiptPage.next:action==='receipts-previous'?receiptBack.at(-1):null,previous});document.querySelector('[data-receipt-status]')?.focus();}
   if(action==='criteria-previous'||action==='criteria-next')await home({cursor:receiptCursor,previous:receiptBack,criteriaOffset:action==='criteria-next'?view.unresolvedPage.next:Math.max(0,view.unresolvedPage.offset-20),expectedRevision:view.revision});
   if(action==='new'){stop();draft={kind:'validation'};page={items:[],next:null};request=null;cursor=null;websitePage={items:[],next:null};websiteAfter=null;websiteBack=[];websiteLoading=false;websiteError=false;form();}
   if(action?.startsWith('websites-')){capture();const direction=action.slice(9);if(direction==='next'&&websitePage.next)await websites(websitePage.next,[...websiteBack,websiteAfter]);if(direction==='previous'&&websiteBack.length)await websites(websiteBack.at(-1),websiteBack.slice(0,-1));if(direction==='retry'&&await websites(websiteAfter,websiteBack))await editions();}
   if(action==='latest'||action==='more'){capture();cursor=action==='more'?page.next:null;await editions();}
   if(action==='policy'){await call('policy',{expectedProjectId:view.projectId,expectedPolicy:view.policy.etag,required:[...document.querySelectorAll('[data-receipt-required]:checked')].map(el=>el.dataset.receiptRequired)});guard();if(at===generation)await home();}
   if(action==='save'){
    if(!document.getElementById('material-form').reportValidity())return true;capture();
    const command={kind:draft.kind,expectedRevision:view.revision,expectedEvidenceRevision:view.evidenceRevision};
    if(draft.kind==='publication'){command.websiteId=draft.website||null;command.publicationJob=draft.edition;}
    else for(const key of ['statement','sourceRevision','sourceSha256',...(draft.kind==='git'?['repository','commit']:['tool','toolVersion','toolSha256'])])command[key]=draft[key];
    const identity=JSON.stringify(command);if(request?.identity!==identity)request={identity,id:crypto.randomUUID()};
    await call('link-receipt',{...command,id:request.id});guard();if(at===generation)await home();
   }
  }finally{if(control.isConnected)control.disabled=false;}
  return true;
 }
 return {home,action,stop};
}
