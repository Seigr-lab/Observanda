import {appearanceFonts,appearancePresets,appearanceCSS} from './website-appearance-model.js';
import {loadWebsiteCanvas} from './website-html-document.js';

const colors={background:'sectionBackground',text:'sectionText',accent:'appearanceAccent',surface:'appearanceSurface',border:'appearanceBorder'};
const fontLabels={sans:'sectionSans',serif:'sectionSerif',mono:'sectionMono'};
export async function editWebsiteAppearance({opened,directory,request,t,signal,current,apply,trigger}){
 const pin={siteId:opened.site.id,path:opened.path,expectedRevision:opened.site.revision};
 const initial=await request('appearance/read',pin,{signal});if(!current()||initial.revision!==pin.expectedRevision)return;
 const dialog=document.createElement('dialog');dialog.className='website-author-dialog website-appearance-dialog';dialog.dataset.siteAppearance='';
 const el=(tag,parent,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;parent.append(node);return node;};
 const label=(host,key,control)=>{const node=el('label',host,t(key));node.append(control);return control;};
 const button=(parent,key)=>{const node=el('button',parent,t(key));node.type='button';node.className='button';return node;};
 const form=el('form',dialog),title=el('h2',form,t('siteAppearance'));title.id='website-appearance-title';dialog.setAttribute('aria-labelledby',title.id);
 el('p',form,t('appearanceHelp'));const columns=el('div',form);columns.className='website-appearance-columns';
 const settings=el('div',columns),preview=el('div',columns);el('h3',preview,t('appearancePreview'));el('code',preview,opened.path);
 const frame=el('iframe',preview);frame.title=t('appearancePreview');frame.setAttribute('sandbox','allow-same-origin');
 const presets=label(settings,'appearancePalette',document.createElement('select'));presets.dataset.appearancePresets='';
 function option(parent,value,key){const node=el('option',parent,t(key));node.value=value;}
 option(presets,'','appearanceCustom');for(const key of Object.keys(appearancePresets))option(presets,key,'appearance'+key[0].toUpperCase()+key.slice(1));
 let draft={...initial.values},sheet=null,submitting=false;
 const controls=new Map();
 function paint(){
  if(sheet)sheet.textContent=Object.keys(draft).length?appearanceCSS(draft):'';
  presets.value=Object.keys(appearancePresets).find(key=>Object.keys(appearancePresets[key]).every(field=>appearancePresets[key][field]===draft[field]))??'';
  save.disabled=submitting||Object.keys({...draft,...initial.values}).every(k=>draft[k]===initial.values[k]);
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
 const reset=button(settings,'appearanceReset');reset.onclick=()=>{draft={};showValues();};
 const status=el('p',form);status.setAttribute('role','status');const footer=el('footer',form);
 const cancel=button(footer,'cancel'),save=button(footer,'appearanceApply');save.type='submit';cancel.onclick=()=>dialog.close();
 form.onsubmit=async event=>{
  event.preventDefault();if(submitting||!form.reportValidity())return;if(!current()){dialog.close();return;}
  submitting=true;save.disabled=cancel.disabled=true;settings.inert=true;status.textContent=t('saving');
  try{if(await apply({...draft})){dialog.close();return;}status.textContent=t('failed');}
  finally{submitting=false;cancel.disabled=false;settings.inert=false;paint();}
 };
 const dismiss=()=>dialog.close();dialog.addEventListener('cancel',event=>{if(submitting)event.preventDefault();});
 dialog.addEventListener('close',()=>{signal.removeEventListener('abort',dismiss);dialog.remove();if(trigger?.isConnected)trigger.focus();},{once:true});
 signal.addEventListener('abort',dismiss,{once:true});
 frame.addEventListener('load',()=>{
  if(!dialog.open||!current()||!frame.contentDocument||frame.contentDocument.URL==='about:blank')return;
  const doc=frame.contentDocument;loadWebsiteCanvas(doc,opened.html,opened.css,new URL(opened.site.cssPath,directory).href);
  for(const link of doc.querySelectorAll('link[data-website-appearance]'))link.remove();
  sheet=doc.createElement('style');doc.head.append(sheet);paint();
  doc.addEventListener('click',event=>{if(event.target.closest('a,button'))event.preventDefault();},true);
  doc.addEventListener('submit',event=>event.preventDefault());
 });
 document.body.append(dialog);dialog.showModal();showValues();const url=new URL(opened.path,directory);url.searchParams.set('canvas','1');frame.src=url.href;presets.focus();
}
