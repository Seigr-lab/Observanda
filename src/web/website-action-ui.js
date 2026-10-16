import {t} from './i18n/index.js';
import {fontSelect,axisControls} from './font-picker.js';
import {websiteTypography} from './website-typography.js';
import {ACTION_KINDS,ACTION_COLORS,ACTION_NUMBERS,actionAppearance,actionStyle,actionStyleKey} from './website-action-style.js';

export function websiteActionUI({state,esc,field,sections,checkpoint,changed}){
 const tr=key=>esc(t('websiteEditor','action_'+key));
 const attr=(owner,slot)=>' data-action-owner="'+owner+'" data-action-slot="'+slot+'"';
 const select=(owner,slot,key,label,values,value)=>field(tr(label),'<select'+attr(owner,slot)+' data-action-key="'+key+'">'+values.map(([v,name])=>'<option value="'+v+'"'+(v===value?' selected':'')+'>'+tr(name)+'</option>').join('')+'</select>');
 function content(section){
  if(!ACTION_KINDS.includes(section.kind))return '';
  let html=select(section.id,'action','appearance','appearance',[['link',['link','hero','download'].includes(section.kind)?'textLink':'plain'],['button','button']],actionAppearance(section));
  if(['link','hero','download'].includes(section.kind))html+='<label class="checkbox"><input type="checkbox"'+attr(section.id,'action')+' data-action-key="arrow"'+((section.action?.arrow??section.kind==='link')?' checked':'')+'>'+tr('arrow')+'</label>';
  if(section.kind==='popup')html+='<details open><summary>'+tr('closeControl')+'</summary>'+select(section.id,'close','content','closeContent',[['icon','icon'],['text','text'],['both','both']],section.close?.content??'icon')+'<label>'+tr('closeLabel')+'<input'+attr(section.id,'close')+' data-action-key="label" value="'+esc(section.close?.label??'')+'" placeholder="'+esc(t('publication','popupClose'))+'"></label>'+select(section.id,'close','appearance','closeAppearance',[['link','plain'],['button','button']],actionAppearance(section,true))+'</details>';
  return '<fieldset><legend>'+tr('display')+'</legend>'+html+'</fieldset>';
 }
 function styles(owner,slot,style,appearance){
  const attrs=attr(owner,slot),label=key=>tr(key),input=(key,html)=>field(label(key),html),reset=key=>'<button type="button" class="text-button" data-action="website-action-reset"'+attrs+(key?' data-key="'+key+'"':'')+' aria-label="'+tr('reset')+(key?' '+label(key):'')+'">'+tr(key?'inherit':'reset')+'</button>';
  const numeric=key=>input(key,'<input type="number" min="'+ACTION_NUMBERS[key]+'"'+(key==='fontWeight'?' max="1000"':'')+' step="any"'+attrs+' data-action-style-key="'+key+'" value="'+(style[key]??'')+'" placeholder="'+tr('inherit')+'">');
  const choose=(key,values)=>input(key,'<select'+attrs+' data-action-style-key="'+key+'"><option value="">'+tr('inherit')+'</option>'+values.map(([v,name])=>'<option value="'+v+'"'+(String(style[key])===v?' selected':'')+'>'+tr(name)+'</option>').join('')+'</select>');
  const palette={...state.book.appearance,...state.book.website.palette},base=owner==='site'?{}:state.book.website.design[appearance==='button'?'buttons':'links']??{};
  const effective=key=>style[key]??base[key]??(key==='background'?'transparent':key==='hoverColor'&&appearance==='button'?palette.surface:slot==='close'&&appearance==='link'?palette.text:palette.accent);
  const colors=ACTION_COLORS.filter(key=>appearance==='button'||['color','hoverColor'].includes(key)).map(key=>{
   const value=effective(key),swatch=value==='transparent'?palette.surface:value;
   return '<div class="action-color">'+input(key,'<input type="color"'+attrs+' data-action-style-key="'+key+'" value="'+esc(swatch)+'">')+(appearance==='button'&&key.toLowerCase().includes('background')?'<label class="checkbox"><input type="checkbox"'+attrs+' data-action-transparent="'+key+'" data-action-opaque="'+esc(swatch)+'"'+(value==='transparent'?' checked':'')+'><span>'+tr('transparent')+'</span></label>':'')+reset(key)+'</div>';
  }).join('');
  return '<p class="muted">'+tr(owner==='site'?'siteInheritHelp':'inheritHelp')+'</p><details open><summary>'+tr('typography')+'</summary>'+input('font',fontSelect(attrs+' data-action-style-key="font"',style.font??'',{first:[['',t('websiteEditor','action_inherit')]]}))+axisControls(style.font??base.font??websiteTypography(state.book).font,style.fontAxes??{},attrs+' data-action-axis="true"')+'<div class="block-style-fields">'+['fontSize','fontWeight','lineHeight','letterSpacing'].map(numeric).join('')+choose('underline',[['true','underlined'],['false','noUnderline']])+'</div></details><details open><summary>'+tr('colors')+'</summary><div class="block-style-fields">'+colors+'</div></details>'+(appearance==='button'?'<details><summary>'+tr('shape')+'</summary><div class="block-style-fields">'+['paddingX','paddingY','radius','borderWidth'].map(numeric).join('')+choose('borderStyle',[['solid','solid'],['dashed','dashed'],['dotted','dotted'],['double','double']])+'</div></details>':'')+choose('width',[['auto','auto'],['full','full']])+reset();
 }
 function sectionStyle(section){if(!ACTION_KINDS.includes(section.kind))return '';return '<details open><summary>'+tr('elementStyle')+'</summary>'+styles(section.id,'action',actionStyle(section),actionAppearance(section))+'</details>'+(section.kind==='popup'?'<details><summary>'+tr('closeStyle')+'</summary>'+styles(section.id,'close',actionStyle(section,true),actionAppearance(section,true))+'</details>':'');}
 function site(){return '<section class="panel"><h2>'+tr('site')+'</h2><p>'+tr('siteHelp')+'</p>'+['buttons','links'].map(slot=>'<details'+(slot==='buttons'?' open':'')+'><summary>'+tr(slot)+'</summary>'+styles('site',slot,state.book.website.design[slot]??{},slot==='buttons'?'button':'link')+'</details>').join('')+'</section>';}
 function owner(el){if(el.dataset.actionOwner==='site')return state.book.website.design;return sections().find(s=>s.id===el.dataset.actionOwner);}
 function input(el,{discrete=false}={}){
  if(!el.dataset.actionOwner)return false;const target=owner(el),slot=el.dataset.actionSlot;if(!target)return true;
  if(el.type==='number'&&!el.checkValidity())return true;
  checkpoint(discrete?null:JSON.stringify(el.dataset));
  const value=target[slot]??={};if(el.dataset.actionKey){value[el.dataset.actionKey]=el.type==='checkbox'?el.checked:el.value;changed(el.tagName==='SELECT'||el.type==='checkbox');return true;}
  const style=el.dataset.actionOwner==='site'?value:value[actionStyleKey(target,slot==='close')]??={};
  if(el.dataset.actionAxis){const axes=style.fontAxes??={};if(el.value==='')delete axes[el.dataset.fontAxis];else axes[el.dataset.fontAxis]=Number(el.value);if(el.dataset.fontAxis==='wght'){delete style.fontWeight;const weight=el.closest('details')?.parentElement.querySelector('[data-action-style-key=fontWeight]');if(weight)weight.value='';}changed();return true;}
  if(el.dataset.actionTransparent){style[el.dataset.actionTransparent]=el.checked?'transparent':el.dataset.actionOpaque;changed(true);return true;}
  const key=el.dataset.actionStyleKey;if(key){if(el.value==='')delete style[key];else style[key]=Object.hasOwn(ACTION_NUMBERS,key)?Number(el.value):key==='underline'?el.value==='true':el.value;if(key==='font')delete style.fontAxes;if(el.type==='color'){const toggle=el.closest('.field')?.parentElement.querySelector('[data-action-transparent]');if(toggle){toggle.checked=false;toggle.dataset.actionOpaque=el.value;}}changed(key==='font');return true;}
  return false;
 }
 function action(button){if(button.dataset.action!=='website-action-reset')return false;const target=owner(button),slot=button.dataset.actionSlot;if(!target)return true;checkpoint();const site=button.dataset.actionOwner==='site';if(button.dataset.key){const style=site?target[slot]:target[slot]?.[actionStyleKey(target,slot==='close')];if(style)delete style[button.dataset.key];}else if(site)delete target[slot];else if(target[slot])delete target[slot][actionStyleKey(target,slot==='close')];changed(true);return true;}
 return {content,sectionStyle,site,input,action};
}
