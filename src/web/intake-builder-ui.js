import {researchTargetPicker} from './research-target-picker.js';
import {t} from './i18n/index.js';
const tr=(key,args)=>t('localIntake',key,args);
const ext=name=>/\.([^./]+)$/.exec(name)?.[0].toLowerCase()??'';

export async function openIntakeBuilder({api,call,frame,esc,field,guard,state,owner,source,restored,recovery,show}){
 const initial=restored?.target??await call('builder-target',{recordId:owner()});guard();
 let target={id:initial.id,revision:initial.revision},targetTitle=initial.title,adapter=restored?.adapter??null,profile=restored?.profile??null;
 let relative=restored?.relative??'',paths=new Set(restored?.paths??[]),folder=source??'',filePage={items:[],next:null},previous=[],after=null;
 let proposal=null,edit=0,id=restored?.id??crypto.randomUUID(),extensions=restored?.extensions??[],lib=null,adapterSave=null;
 let amends=restored?.amends??null,priorPage=null;
 const label=key=>esc(tr(key)),btn=(action,key)=>'<button type="button" class="button" data-build="'+action+'">'+label(key)+'</button>';
 const input=(key,max,required=false)=>field(label(key),'<input data-field="'+key+'" maxlength="'+max+'" '+(required?'required':'')+'>');
 frame(tr('build'),'<section data-intake-builder><div class="inline-actions"><strong data-target></strong>'+btn('target','changeTarget')+'</div><div data-target-picker></div>'+
  '<div class="material-fields">'+field(label('source'),'<input data-source required>')+btn('folder','choose')+'</div>'+
  '<fieldset><legend>'+label('files')+'</legend><div class="inline-actions">'+btn('browse','browseFiles')+btn('parent','parentFolder')+btn('all','selectFolder')+btn('clear','clearSelection')+'</div><p data-path></p><div data-files></div><div class="inline-actions">'+btn('prev','previousFiles')+btn('next','nextFiles')+'</div><p data-count role="status"></p></fieldset>'+
  '<div class="material-fields">'+input('packageTitle',300,true)+field(label('purpose'),'<select data-field="purpose">'+['evidence','preparation','analysis','amendment'].map(value=>'<option value="'+value+'">'+label('purpose-'+value)+'</option>').join('')+'</select>')+
  input('sourceRevision',500)+input('method',3000)+input('toolName',200)+input('toolVersion',200)+'</div>'+
  '<div data-amend hidden><p data-prior></p>'+btn('prior','choosePrior')+btn('remove-prior','removePrior')+'<div data-prior-options></div></div>'+
  '<div class="inline-actions">'+btn('adapters','chooseAdapter')+btn('profiles','chooseProfile')+btn('drop-profile','clearProfile')+'</div>'+
  '<p data-settings></p><div data-library></div>'+
  '<details><summary>'+label('saveAdapter')+'</summary>'+input('adapterName',300)+btn('save-adapter','saveAdapter')+'</details>'+
  '<div class="inline-actions">'+btn('review','reviewPackage')+'</div><p data-build-status role="status"></p><div data-preview></div></section>');
 const root=document.querySelector('[data-intake-builder]'),get=selector=>root.querySelector(selector),form=root.closest('form'),events=new AbortController();
 const alive=()=>{guard();if(!root.isConnected)throw new DOMException('Closed','AbortError');};
 const fieldValue=key=>get('[data-field="'+key+'"]').value;
 const scoped=(name,data={})=>call(name,{recordId:target.id,...data},{signal:events.signal});
 const status=get('[data-build-status]'),fileArea=get('[data-files]'),libArea=get('[data-library]'),preview=get('[data-preview]');
 const setStatus=value=>status.textContent=value;
 const displayTarget=()=>get('[data-target]').textContent=tr('namedTarget',{title:targetTitle??''});
 const displayCount=()=>get('[data-count]').textContent=tr('selectedCount',{count:paths.size});
 const displaySettings=()=>get('[data-settings]').textContent=[adapter?.title,profile?.title].filter(Boolean).join(' · ');
 const displayPrior=()=>{get('[data-amend]').hidden=fieldValue('purpose')!=='amendment';get('[data-prior]').textContent=amends?.title??'';get('[data-build="remove-prior"]').disabled=!amends;};
 const invalidate=()=>{edit++;proposal=null;preview.replaceChildren();setStatus('');};
 const updateDraft=()=>form.dispatchEvent(new Event('change',{bubbles:true}));
 get('[data-source]').value=folder;
 for(const key of ['packageTitle','purpose','sourceRevision','method','toolName','toolVersion','adapterName']){
  if(restored?.fields&&Object.hasOwn(restored.fields,key))get('[data-field="'+key+'"]').value=restored.fields[key];
 }
 const capture=()=>({source:get('[data-source]').value,proposal:proposal?{id:proposal.manifest.id,pin:proposal.preview.pin}:null,
  builder:{id,target:{...target},relative,paths:[...paths],adapter,profile,extensions,amends,
   fields:Object.fromEntries(['packageTitle','purpose','sourceRevision','method','toolName','toolVersion','adapterName'].map(key=>[key,fieldValue(key)]))}});
 recovery?.mount(form,capture);
 function paintFiles(){
  get('[data-path]').textContent=relative;
  get('[data-build="prev"]').disabled=!previous.length;get('[data-build="next"]').disabled=!filePage.next;get('[data-build="parent"]').disabled=!relative;
  fileArea.innerHTML=filePage.items.map((item,index)=>item.directory?
   '<button type="button" class="button" data-build="directory" data-index="'+index+'">'+esc(item.path.split('/').at(-1))+' /</button>':
   '<div><label><input type="checkbox" data-file="'+index+'" '+(paths.has(item.path)?'checked':'')+'>'+esc(item.path.split('/').at(-1))+'</label></div>').join('');
  displayCount();
 }
 async function list(cursor){
  folder=get('[data-source]').value;const requested=folder;
  const page=await scoped('builder-files',{source:folder,relative,after:cursor});alive();
  if(requested!==get('[data-source]').value)return;after=cursor;filePage=page;paintFiles();
 }
 function resetFiles(){paths.clear();relative='';filePage={items:[],next:null};after=null;previous=[];paintFiles();}
 function closeLibrary(){lib=null;libArea.replaceChildren();}
 async function library(kind,cursor=null){
  if(!lib||lib.kind!==kind){
   lib={kind,rows:[],next:null};
   libArea.innerHTML=field(label('findSetting'),'<input type="search" data-search maxlength="200">')+
    '<div class="inline-actions">'+btn('find-setting','findSetting')+btn('more-setting','nextFiles')+btn('close-setting','closeSettings')+'</div><div data-options></div>';
  }
  const selected=lib,query=get('[data-search]').value;
  const page=await scoped(kind==='profiles'?'builder-profiles':'builder-adapters',{query,after:cursor});alive();if(lib!==selected)return;
  lib.rows=page.items;lib.next=page.next;get('[data-build="more-setting"]').disabled=page.next===null;
  get('[data-options]').innerHTML=page.items.length?page.items.map((item,index)=>'<button class="button" type="button" data-build="use-setting" data-index="'+index+'">'+esc(item.title)+'</button>').join(''):label('noSettings');
 }
 function reviewed(report){
  const unsupported=report.formats.filter(item=>item.format==='original');
  preview.innerHTML='<h3>'+esc(report.manifest.title)+'</h3><p>'+esc(tr('namedTarget',{title:report.targetTitle}))+' · '+esc(tr('selectedCount',{count:report.manifest.files.length}))+'</p>'+
   (unsupported.length?'<details><summary>'+esc(tr('originalsOnly',{count:unsupported.length}))+'</summary><ul>'+unsupported.map(item=>'<li>'+esc(item.path)+'</li>').join('')+'</ul></details>':'')+
   '<details><summary>'+label('technicalManifest')+'</summary><dl>'+report.manifest.files.map(file=>'<dt>'+esc(file.path)+'</dt><dd><code>'+esc(file.sha256)+'</code> · '+file.size+' B</dd>').join('')+'</dl></details>'+
   '<div class="inline-actions">'+btn('download','exportManifest')+btn('stage','stage')+'</div>';
 }
 const picker=researchTargetPicker({state,api,esc,field,active:()=>root.isConnected,excludeId:()=>null});
 root.addEventListener('input',event=>{
  if(event.target.matches('[data-source]')){resetFiles();folder=get('[data-source]').value;}
  if(event.target.matches('[data-source],[data-field]')){if(event.target.dataset.field==='purpose')displayPrior();invalidate();}
 },{signal:events.signal});
 root.addEventListener('change',event=>{
  if(!event.target.matches('[data-file]'))return;
  const item=filePage.items[Number(event.target.dataset.file)];if(!item)return;
  if(event.target.checked)paths.add(item.path);else paths.delete(item.path);invalidate();displayCount();
 },{signal:events.signal});
 root.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-build]');
  if(!button||button.disabled||root.getAttribute('aria-busy')==='true')return;
  const action=button.dataset.build;root.setAttribute('aria-busy','true');
  try{
   if(action==='target'){
    const host=get('[data-target-picker]');
    picker.open({root:host,recordsOnly:true,onCancel:()=>host.replaceChildren(),onChoose:async(item,{stillCurrent})=>{
     if(!stillCurrent())return;target={id:item.id,revision:item.revision};targetTitle=item.title;
     picker.stop();host.replaceChildren();amends=null;priorPage=null;get('[data-prior-options]').replaceChildren();displayPrior();displayTarget();invalidate();updateDraft();
    }});return;
   }
   if(action==='folder'){
    const result=await api('/api/storage/pick',{path:get('[data-source]').value},{adopt:false,signal:events.signal});alive();
    if(!result.path)return;get('[data-source]').value=result.path;resetFiles();invalidate();updateDraft();await list(null);return;
   }
   if(action==='browse'){previous=[];await list(null);return;}
   if(action==='directory'||action==='parent'){
    relative=action==='parent'?relative.split('/').slice(0,-1).join('/'):filePage.items[Number(button.dataset.index)].path;
    previous=[];await list(null);updateDraft();return;
   }
   if(action==='prev'||action==='next'){if(action==='prev')await list(previous.pop());else{previous.push(after);await list(filePage.next);}return;}
   if(action==='clear'){paths.clear();invalidate();paintFiles();updateDraft();return;}
   if(action==='all'){
    const selected=await scoped('builder-folder',{source:get('[data-source]').value,relative,extensions});alive();
    for(const member of selected.paths)paths.add(member);
    invalidate();paintFiles();updateDraft();return;
   }
   if(action==='adapters'||action==='profiles'){await library(action);return;}
   if(action==='prior'||action==='next-prior'){
    priorPage=await scoped('builder-antecedents',{cursor:action==='next-prior'?priorPage.next:null});alive();
    get('[data-prior-options]').innerHTML=priorPage.items.map((item,index)=>'<button type="button" class="button" data-build="use-prior" data-index="'+index+'">'+esc(item.title+' · '+item.date.slice(0,10))+'</button>').join('')+
     (priorPage.items.length?'':label('noSettings'))+(priorPage.next?btn('next-prior','nextFiles'):'');return;
   }
   if(action==='use-prior'||action==='remove-prior'){
    amends=action==='use-prior'?priorPage.items[Number(button.dataset.index)]:null;
    get('[data-prior-options]').replaceChildren();displayPrior();invalidate();updateDraft();return;
   }
   if(action==='close-setting'){closeLibrary();return;}
   if(action==='find-setting'||action==='more-setting'){await library(lib.kind,action==='more-setting'?lib.next:null);return;}
   if(action==='drop-profile'){profile=null;invalidate();displaySettings();updateDraft();return;}
   if(action==='use-setting'){
    const selected=lib.rows[Number(button.dataset.index)];
    if(lib.kind==='profiles')profile={title:selected.title,ref:selected.ref};
    else{
     const loaded=await scoped('builder-adapter-read',{ref:selected.ref});alive();
     adapter={title:loaded.title,ref:loaded.ref};profile=loaded.profile?{title:loaded.profileTitle,ref:loaded.profile}:null;
     const settings=loaded.settings;extensions=settings.extensions;
     for(const [key,value] of Object.entries({purpose:settings.purpose,method:settings.method,toolName:settings.tool,toolVersion:settings.toolVersion}))get('[data-field="'+key+'"]').value=value;
     displayPrior();
    }
    closeLibrary();invalidate();displaySettings();updateDraft();return;
   }
   if(action==='save-adapter'){
    const name=fieldValue('adapterName').trim();if(!name){get('[data-field="adapterName"]').focus();setStatus(tr('nameAdapter'));return;}
    const settings={purpose:fieldValue('purpose'),method:fieldValue('method'),tool:fieldValue('toolName'),toolVersion:fieldValue('toolVersion'),
     extensions:paths.size?[...new Set([...paths].map(ext).filter(Boolean))].sort():extensions};
    const input={title:name,expectedRevision:target.revision,profile:profile?.ref??null,settings};
    const signature=JSON.stringify([target.id,input]);
    if(adapterSave?.signature!==signature)adapterSave={signature,id:crypto.randomUUID()};
    const result=await scoped('builder-adapter-save',{id:adapterSave.id,...input});alive();
    adapter={title:name,ref:result.ref};extensions=settings.extensions;invalidate();displaySettings();updateDraft();setStatus(tr('adapterSaved'));return;
   }
   if(action==='review'){
    if(!form.reportValidity())return;
    if(!paths.size){setStatus(tr('chooseFilesFirst'));return;}
    const requested=edit;
    setStatus(tr('checkingFiles'));
    const report=await scoped('builder-review',{id,expectedRevision:target.revision,source:get('[data-source]').value,paths:[...paths],
     title:fieldValue('packageTitle'),purpose:fieldValue('purpose'),sourceRevision:fieldValue('sourceRevision'),method:fieldValue('method'),
     tool:fieldValue('toolName'),toolVersion:fieldValue('toolVersion'),profile:profile?.ref??null,adapter:adapter?.ref??null,
     amends:fieldValue('purpose')==='amendment'&&amends?{id:amends.id,pin:amends.pin}:null});
    alive();if(requested!==edit)return;proposal=report;reviewed(report);setStatus('');updateDraft();return;
   }
   if(action==='download'&&proposal){
    const url=URL.createObjectURL(new Blob([JSON.stringify(proposal.manifest,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');
    link.href=url;link.download='intake.observanda.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
   }
   if(action==='stage'&&proposal){
    const targetId=target.id,accepted=proposal;
    const result=await scoped('stage',{source:get('[data-source]').value,id:accepted.manifest.id,expectedPin:accepted.preview.pin,authoredManifest:accepted.manifest,proof:accepted.proof});
    alive();await recovery?.discard(form);await show(result.id,targetId);
   }
  }catch(error){
   if(root.isConnected&&error.name!=='AbortError'){
    const detail=error.details?.find(item=>typeof item.path==='string');
    setStatus((detail?detail.path+' · ':'')+error.message);
   }
  }finally{root.removeAttribute('aria-busy');}
 },{signal:events.signal});
 displayTarget();displayCount();displaySettings();displayPrior();paintFiles();
 if(restored){
  const actual=await scoped('builder-target');alive();targetTitle=actual.title;displayTarget();
  if(actual.revision!==target.revision)setStatus(tr('targetChanged'));
 }
 return ()=>{events.abort();picker.stop();};
}
