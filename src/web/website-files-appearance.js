import {appearanceFonts,appearancePresets,appearanceCSS,scopedAppearanceCSS} from './website-appearance-model.js';
import {confirmAction} from './confirm-action.js';
import {loadWebsiteCanvas} from './website-html-document.js';
import {websiteLayerAt} from './website-layer-model.js';

const colors={background:'sectionBackground',text:'sectionText',accent:'appearanceAccent',surface:'appearanceSurface',border:'appearanceBorder'};
const fontLabels={sans:'sectionSans',serif:'sectionSerif',mono:'sectionMono'};
export async function editWebsiteAppearance({opened,directory,request,t,signal,current,apply,trigger,themes=false,blockPath=null,sectionTitle=''}){
 const pin={siteId:opened.site.id,path:opened.path,expectedRevision:opened.site.revision};
 const initial=await request(themes?'themes/read':'appearance/read',themes?{...pin,blockPath}:pin,{signal});if(!current()||initial.revision!==pin.expectedRevision)return;
 const dialog=document.createElement('dialog');dialog.className='website-author-dialog website-appearance-dialog';dialog.dataset.siteAppearance='';
 const el=(tag,parent,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;parent.append(node);return node;};
 const label=(host,key,control)=>{const node=el('label',host,t(key));node.append(control);return control;};
 const button=(parent,key)=>{const node=el('button',parent,t(key));node.type='button';node.className='button';return node;};
 const form=el('form',dialog),title=el('h2',form,t(themes?'designThemes':'siteAppearance'));title.id='website-appearance-title';dialog.setAttribute('aria-labelledby',title.id);
 el('p',form,t(themes?'designThemesHelp':'appearanceHelp'));const columns=el('div',form);columns.className='website-appearance-columns';
 const settings=el('div',columns),preview=el('div',columns);el('h3',preview,t('appearancePreview'));el('code',preview,opened.path);
 const frame=el('iframe',preview);frame.title=t('appearancePreview');frame.setAttribute('sandbox','allow-same-origin');
 function option(parent,value,key){const node=el('option',parent,t(key));node.value=value;}
 let collection,nameInput,scope,usage,theme=null,original=initial.values??{},previewTarget=null;
 if(themes){
  collection=label(settings,'savedThemes',document.createElement('select'));option(collection,'','newTheme');
  for(const item of initial.items){const o=el('option',collection,item.name);o.value=item.id;}
  collection.value=initial.section||initial.effective||initial.items[0]?.id||'';
  nameInput=label(settings,'themeName',document.createElement('input'));nameInput.required=true;nameInput.maxLength=160;
  scope=label(settings,'themeScope',document.createElement('select'));option(scope,'page','themePage');
  if(initial.folder){const o=el('option',scope,t('themeFolder',{folder:initial.folder}));o.value='folder';}
  if(initial.section!==null){const o=el('option',scope,t('themeSection',{section:sectionTitle}));o.value='section';scope.value='section';}
  option(scope,'library','themeLibraryOnly');usage=el('p',settings);
 }
 const presets=label(settings,'appearancePalette',document.createElement('select'));presets.dataset.appearancePresets='';
 option(presets,'','appearanceCustom');for(const key of Object.keys(appearancePresets))option(presets,key,'appearance'+key[0].toUpperCase()+key.slice(1));
 let draft={...original},sheet=null,submitting=false;
 const controls=new Map();
 function paint(){
  if(sheet){
   if(themes){
    const doc=sheet.ownerDocument,target=scope.value==='section'?websiteLayerAt(doc,blockPath):doc.body;
    if(previewTarget&&previewTarget.node!==target){if(previewTarget.value===null)previewTarget.node.removeAttribute('data-website-theme');else previewTarget.node.setAttribute('data-website-theme',previewTarget.value);previewTarget=null;}
    if(target&&!previewTarget)previewTarget={node:target,value:target.getAttribute('data-website-theme')};
    const id=theme?.id??previewId;if(target)target.setAttribute('data-website-theme',id);
    sheet.textContent=scopedAppearanceCSS(id,draft);
   }else sheet.textContent=Object.keys(draft).length?appearanceCSS(draft):'';
  }
  presets.value=Object.keys(appearancePresets).find(key=>Object.keys(appearancePresets[key]).every(field=>appearancePresets[key][field]===draft[field]))??'';
  const unchanged=Object.keys({...draft,...original}).every(k=>draft[k]===original[k]);
  const assigned=themes&&({section:initial.section,page:initial.pageTheme,folder:initial.folderTheme})[scope.value];
  save.disabled=submitting||(themes?(!nameInput.value.trim()||!Object.keys(draft).length||theme&&unchanged&&nameInput.value.trim()===theme.name&&(scope.value==='library'||theme.id===assigned)):unchanged);
  if(themes){inherit.disabled=submitting||!assigned;remove.disabled=submitting||!theme;}
 }
 function refresh(){for(const [key,control] of controls){if(control.type==='color')control.value=draft[key]??appearancePresets.coast[key];else control.value=draft[key]??'';}paint();}
 for(const [key,name] of Object.entries(colors)){
  const group=el('div',settings);group.className='website-appearance-color';
  const color=label(group,name,document.createElement('input'));color.type='color';color.dataset.appearanceColor=key;
  const code=el('input',group);code.type='text';code.dataset.appearanceHex=key;code.setAttribute('aria-label',t(name)+' · HEX');code.placeholder=t('sectionInherit');code.maxLength=7;code.pattern='#[a-fA-F0-9]{6}';
  controls.set(key,color);
  color.oninput=()=>{draft[key]=code.value=color.value;paint();};
  code.oninput=()=>{if(!code.value)delete draft[key];else if(!code.validity.valid)return;else draft[key]=code.value.toLowerCase();color.value=draft[key]??appearancePresets.coast[key];paint();};
 }
 for(const [key,name] of [['reading','appearanceReading'],['heading','appearanceHeading']]){
  const font=label(settings,name,document.createElement('select'));font.dataset.appearanceFont=key;
  option(font,'','sectionInherit');for(const family of Object.keys(appearanceFonts))option(font,family,fontLabels[family]);
  controls.set(key,font);font.onchange=()=>{if(font.value)draft[key]=font.value;else delete draft[key];paint();};
 }
 function showValues(){for(const code of settings.querySelectorAll('[data-appearance-hex]'))code.value=draft[code.dataset.appearanceHex]??'';refresh();}
 presets.onchange=()=>{if(presets.value){draft={...appearancePresets[presets.value]};showValues();}};
 const reset=button(settings,themes?'themeReset':'appearanceReset');reset.onclick=()=>{draft=themes?{...original}:{};showValues();};
 const status=el('p',form);status.setAttribute('role','status');const footer=el('footer',form);
 const previewId=themes?crypto.randomUUID():null;
 const inherit=themes?button(footer,'themeInherit'):null,remove=themes?button(footer,'themeRemove'):null;
 const cancel=button(footer,'cancel'),save=button(footer,themes?'themeSave':'appearanceApply');save.type='submit';cancel.onclick=()=>dialog.close();
 async function submit(change){
  if(submitting)return;if(!current()){dialog.close();return;}
  submitting=true;save.disabled=cancel.disabled=true;settings.inert=true;status.textContent=t('saving');
  try{if(await apply(change)){dialog.close();return;}status.textContent=t('failed');}
  catch(error){status.textContent=error.message||t('failed');}
  finally{submitting=false;cancel.disabled=false;settings.inert=false;paint();}
 }
 form.onsubmit=event=>{
  event.preventDefault();if(!form.reportValidity())return;
  void submit(themes?{action:theme?'design':'create',name:nameInput.value,themeId:theme?.id??null,scope:scope.value,blockPath,values:{...draft}}:{...draft});
 };
 if(themes){
  const choose=()=>{theme=initial.items.find(i=>i.id===collection.value)??null;original=theme?.values??appearancePresets.coast;draft={...original};nameInput.value=theme?.name??'';usage.textContent=theme?t('themeUsage',{count:theme.uses}):t('themeNewHelp');showValues();};
  collection.onchange=choose;nameInput.oninput=paint;scope.onchange=paint;
  inherit.onclick=()=>void submit({action:'apply',themeId:null,scope:scope.value,blockPath});
  remove.onclick=async()=>{if(await confirmAction(t('themeConfirmRemove',{name:theme.name}),{action:'delete'}))void submit({action:'remove',themeId:theme.id});};
  choose();
 }
 const dismiss=()=>dialog.close();dialog.addEventListener('cancel',event=>{if(submitting)event.preventDefault();});
 dialog.addEventListener('close',()=>{signal.removeEventListener('abort',dismiss);dialog.remove();if(trigger?.isConnected)trigger.focus();},{once:true});
 signal.addEventListener('abort',dismiss,{once:true});
 frame.addEventListener('load',()=>{
  if(!dialog.open||!current()||!frame.contentDocument||frame.contentDocument.URL==='about:blank')return;
  const doc=frame.contentDocument;loadWebsiteCanvas(doc,opened.html,opened.css,new URL(opened.site.cssPath,directory).href);
  if(!themes)for(const link of doc.querySelectorAll('link[data-website-appearance]'))link.remove();
  sheet=doc.createElement('style');doc.head.append(sheet);paint();
  doc.addEventListener('click',event=>{if(event.target.closest('a,button'))event.preventDefault();},true);
  doc.addEventListener('submit',event=>event.preventDefault());
 });
 document.body.append(dialog);dialog.showModal();showValues();const url=new URL(opened.path,directory);url.searchParams.set('canvas','1');frame.src=url.href;(collection??presets).focus();
}
