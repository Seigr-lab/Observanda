import {operationProgress} from './operation-progress-ui.js';

// Site regions: a component shown in a page slot on every page, on the pages of
// a folder or on one page. The site setting is the default for each slot.
const SLOTS=['header','sidebar','secondary-sidebar','footer'];
const slotKey={header:'regionHeader',sidebar:'regionSidebar','secondary-sidebar':'regionSecondarySidebar',footer:'regionFooter'};
const FOLLOW='',NONE='none';
export function websiteFilesRegions({request,site,esc,tr,render,adopt,close}){
 let data=null,revision=null,siteId=null,path=null,epoch=0,notice='';
 const live=()=>site()?.site.id===siteId&&site()?.site.revision===revision;
 const panel=()=>document.querySelector('.website-files-regions');
 const action=(key,id,attributes='')=>'<button type="button" class="button" data-action="website-files-regions-'+id+'" '+attributes+'>'+esc(tr(key))+'</button>';
 const folderOf=page=>page.includes('/')?page.slice(0,page.lastIndexOf('/')):'';
 function reset(){epoch++;data=revision=siteId=path=null;notice='';}
 async function open(){
  const current=site(),token=++epoch;
  const result=await request('regions',{siteId:current.site.id,expectedRevision:current.site.revision,path:current.path});
  if(token!==epoch||site()?.site.id!==current.site.id||site()?.site.revision!==result.revision)return;
  data=result;revision=result.revision;siteId=current.site.id;path=current.path;
 }
 function componentOptions(selected,{follow=false,draft=false}={}){
  const rows=data.components.filter(row=>draft||!row.draft);
  return (follow?'<option value="'+FOLLOW+'"'+(selected===undefined?' selected':'')+'>'+esc(tr('regionFollow'))+'</option>':'')+
   '<option value="'+NONE+'"'+(selected===null?' selected':'')+'>'+esc(tr('regionNone'))+'</option>'+
   rows.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===selected?' selected':'')+'>'+esc(row.name)+'</option>').join('');
 }
 function settingsForm(slot,settings){
  const s=settings??{side:slot==='secondary-sidebar'?'right':'left',width:260,sticky:false,background:null,color:null,padding:0,mobile:'expanded',mobileTitle:''};
  const sidebar=slot==='sidebar'||slot==='secondary-sidebar',field=name=>'data-region-setting="'+name+'"';
  const colour=(name,key)=>'<label><input type="checkbox" '+field(name+'-on')+(s[name]?' checked':'')+'> '+esc(tr(key))+'</label><input type="color" aria-label="'+esc(tr(key))+'" '+field(name)+' value="'+esc(s[name]??'#ffffff')+'"'+(s[name]?'':' disabled')+'>';
  return '<details class="website-region-settings"><summary>'+esc(tr('regionSettings'))+'</summary>'+
   (sidebar?'<label>'+esc(tr('regionSide'))+'<select '+field('side')+'><option value="left"'+(s.side==='left'?' selected':'')+'>'+esc(tr('regionLeft'))+'</option><option value="right"'+(s.side==='right'?' selected':'')+'>'+esc(tr('regionRight'))+'</option></select></label>'+
    '<label>'+esc(tr('regionWidth'))+'<input type="number" min="180" max="480" step="10" '+field('width')+' value="'+s.width+'"></label>':'')+
   '<label><input type="checkbox" '+field('sticky')+(s.sticky?' checked':'')+'> '+esc(tr('regionSticky'))+'</label>'+
   colour('background','regionBackground')+colour('color','regionText')+
   '<label>'+esc(tr('regionPadding'))+'<input type="number" min="0" max="80" step="1" '+field('padding')+' value="'+s.padding+'"></label>'+
   '<label>'+esc(tr('regionPhone'))+'<select '+field('mobile')+'><option value="expanded"'+(s.mobile==='expanded'?' selected':'')+'>'+esc(tr('regionExpanded'))+'</option><option value="collapsed"'+(s.mobile==='collapsed'?' selected':'')+'>'+esc(tr('regionCollapsed'))+'</option></select></label>'+
   '<label>'+esc(tr('regionPhoneTitle'))+'<input '+field('mobileTitle')+' maxlength="160" value="'+esc(s.mobileTitle)+'"></label></details>';
 }
 function siteRows(){
  return data.slots.map(row=>'<li data-region-slot="'+row.slot+'"><h4>'+esc(tr(slotKey[row.slot]))+'</h4>'+
   '<label>'+esc(tr('regionComponent'))+'<select data-region-choice>'+componentOptions(row.component??null)+'</select></label>'+
   settingsForm(row.slot,row.settings)+action('regionApplySite','site','data-region="'+row.slot+'"')+'</li>').join('');
 }
 function scopeRows(scope,target){
  const current=slot=>{const row=data.overrides.find(o=>o.scope===scope&&o.path===target&&o.slot===slot);return row?row.component:undefined;};
  return SLOTS.map(slot=>'<li data-region-slot="'+slot+'"><label>'+esc(tr(slotKey[slot]))+'<select data-region-choice>'+componentOptions(current(slot),{follow:true,draft:scope==='page'&&site()?.site.pages.find(p=>p.path===target)?.draft})+'</select></label>'+
   action('regionApply',scope,'data-region="'+slot+'" data-region-target="'+esc(target)+'"')+'</li>').join('');
 }
 function overrideRows(){
  if(!data.overrides.length)return '<p>'+esc(tr('regionNoOverrides'))+'</p>';
  return '<ul class="website-region-overrides">'+data.overrides.map(row=>'<li>'+esc(tr(row.scope==='page'?'regionPageOverride':'regionFolderOverride',{path:row.path,slot:tr(slotKey[row.slot]),component:row.component?row.name:tr('regionNone')}))+' '+
   action('regionFollowSite','clear','data-region="'+row.slot+'" data-region-scope="'+row.scope+'" data-region-target="'+esc(row.path)+'"')+'</li>').join('')+'</ul>';
 }
 function view(){
  if(!data||!live())return '<section class="panel website-files-regions"><p>'+esc(tr('changed'))+'</p>'+action('reopen','reload')+'</section>';
  const folder=folderOf(path),shown=data.page.map(row=>tr(slotKey[row.slot])+': '+row.name).join(', ')||tr('regionNoneOnPage');
  return '<section class="panel website-files-regions" aria-label="'+esc(tr('regions'))+'"><header><div><h2>'+esc(tr('regions'))+'</h2><p>'+esc(tr('regionScope'))+'</p></div>'+action('closePreview','close')+'</header>'+
   (notice?'<p role="status">'+esc(notice)+'</p>':'')+
   (data.components.length?'':'<p>'+esc(tr('regionNeedsComponent'))+'</p>')+
   '<section><h3>'+esc(tr('regionSite'))+'</h3><ul class="website-region-slots">'+siteRows()+'</ul></section>'+
   (folder?'<section><h3>'+esc(tr('regionFolder',{folder}))+'</h3><ul class="website-region-slots">'+scopeRows('folder',folder)+'</ul></section>':'')+
   '<section><h3>'+esc(tr('regionPage',{page:path}))+'</h3><p>'+esc(tr('regionOnPage',{regions:shown}))+'</p><ul class="website-region-slots">'+scopeRows('page',path)+'</ul></section>'+
   '<section><h3>'+esc(tr('regionOverrides'))+'</h3>'+overrideRows()+'</section></section>';
 }
 function readSettings(item){
  const value=name=>item.querySelector('[data-region-setting="'+name+'"]'),settings={};
  if(value('side'))settings.side=value('side').value;
  if(value('width'))settings.width=Number(value('width').value);
  settings.sticky=value('sticky').checked;
  for(const name of ['background','color'])settings[name]=value(name+'-on').checked?value(name).value.toLowerCase():null;
  settings.padding=Number(value('padding').value);settings.mobile=value('mobile').value;settings.mobileTitle=value('mobileTitle').value.trim();
  if(!(settings.width===undefined||Number.isInteger(settings.width)&&settings.width>=180&&settings.width<=480)){value('width').focus();throw Error(tr('regionInvalidWidth'));}
  if(!Number.isInteger(settings.padding)||settings.padding<0||settings.padding>80){value('padding').focus();throw Error(tr('regionInvalidPadding'));}
  if(settings.mobile==='collapsed'&&!settings.mobileTitle){value('mobileTitle').focus();throw Error(tr('regionNeedsPhoneTitle'));}
  return settings;
 }
 async function assign(change){
  if(!live())throw Error(tr('changed'));
  const host=panel(),progress=host?operationProgress({host,stageText:tr,title:()=>tr('regionSave'),compact:true,disableControls:true}):null,token=epoch;
  let next;try{next=await request('regions/assign',{siteId,expectedRevision:revision,path,...change},progress?{onProgress:progress.update}:undefined);}finally{progress?.close();}
  if(token!==epoch)return;
  adopt(next);await open();notice=tr('regionSaved');render();panel()?.querySelector('[role="status"]')?.focus?.();
 }
 async function handle(operation,element){
  const name=operation.slice('regions-'.length),item=element.closest('[data-region-slot]'),slot=element.dataset.region;
  if(name==='close'){reset();close();return;}
  if(name==='reload'){await open();render();return;}
  if(name==='clear'){await assign({slot,scope:element.dataset.regionScope,target:element.dataset.regionTarget});return;}
  const choice=item.querySelector('[data-region-choice]').value;
  if(name==='site'){
   if(choice===NONE)await assign({slot,component:null});
   else await assign({slot,component:choice,settings:readSettings(item)});
   return;
  }
  if(name==='folder'||name==='page'){
   const component=choice===FOLLOW?undefined:choice===NONE?null:choice;
   await assign({slot,scope:name,target:element.dataset.regionTarget,...(component===undefined?{}:{component})});
  }
 }
 function bind(){
  const root=panel();if(!root)return;
  root.addEventListener('change',event=>{
   const toggle=event.target.closest('[data-region-setting$="-on"]');if(!toggle)return;
   const name=toggle.dataset.regionSetting.slice(0,-3);toggle.closest('details').querySelector('[data-region-setting="'+name+'"]').disabled=!toggle.checked;
  });
 }
 return {open,view,bind,handle,reset};
}
