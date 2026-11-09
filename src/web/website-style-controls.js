import {BUNDLED_FONTS} from './font-catalogue.js';

const choices={
 'text-align':['start','center','end','justify'],display:['block','inline-block','flex','inline-flex','grid','inline-grid','flow-root'],
 'align-items':['start','end','center','baseline','stretch'],'justify-content':['start','end','center','space-between','space-around','space-evenly']
};
const get=tag=>document.createElement(tag);
export function styleOptions(select,entries){
 select.replaceChildren(...entries.map(([value,label])=>new Option(label,value)));
}

export function styleField(key,value,fonts,t,changed){
 const label=get('div'),controlId='website-style-field-'+crypto.randomUUID();
 label.className='website-token-field';
 const title=get('label');title.htmlFor=controlId;title.textContent=t('tokenProp_'+key);label.append(title);
 const read=control=>{control.id=controlId;control.dataset.styleProperty=key;control.value=value??'';label.append(control);control.addEventListener('input',()=>changed(control.value));return control;};
 if(key==='font-family'||choices[key]){
  const select=get('select');
  const options=choices[key]?.map(v=>[v,t('tokenChoice_'+v)])??[
   ['sans-serif',t('sectionSans')],['serif',t('sectionSerif')],['monospace',t('sectionMono')],['system-ui',t('tokenSystemFont')],
   ...BUNDLED_FONTS.map(f=>[f.id,f.family]),...fonts.map(f=>[f.id,f.label+' · '+t(f.embed?'tokenPublishFont':'tokenFallbackOnly')])
  ];
  if(value&&!options.some(pair=>pair[0]===value))options.push([value,value]);
  styleOptions(select,[['',t('sectionInherit')],...options]);read(select);return label;
 }
 if(['color','background-color','border-color'].includes(key)){
  const group=get('div'),picker=get('input'),field=get('input');
  group.className='website-token-color';picker.type='color';picker.value=/^#[a-f\d]{6}$/i.test(value)?value:'#000000';picker.setAttribute('aria-label',title.textContent);
  field.type='text';field.maxLength=12;field.placeholder=t('sectionInherit');read(field);
  picker.oninput=()=>{field.value=picker.value;changed(field.value);};field.addEventListener('input',()=>{if(/^#[a-f\d]{6}$/i.test(field.value))picker.value=field.value;});
  group.append(picker,field);label.append(group);return label;
 }
 if(key==='grid-template-columns'){
  const control=get('input');control.type='number';control.min=1;control.max=99;control.step=1;control.placeholder=t('sectionInherit');
  const match=/^repeat\((\d+),\s*minmax\(0,\s*1fr\)\)$/.exec(value??'');
  if(!value||match){control.id=controlId;control.dataset.styleProperty=key;control.value=match?.[1]??'';control.oninput=()=>changed(control.value?'repeat('+control.value+', minmax(0, 1fr))':'');label.append(control);return label;}
 }
 if(key==='aspect-ratio'||key==='grid-template-columns'||value?.startsWith('clamp(')){
  const control=get('input');control.type='text';control.placeholder=key==='aspect-ratio'?'16 / 9':t('sectionInherit');read(control);return label;
 }
 const group=get('div'),number=get('input'),unit=get('select');group.className='website-token-number';
 const match=/^(-?(?:\d+(?:\.\d+)?|\.\d+))(.*)$/.exec(value??'');
 const units=key==='font-weight'?['']:key==='line-height'?['','px','rem','em','%']:['px','rem','em','%','ch','vw','vh'];
 if(match?.[2]&&!units.includes(match[2]))units.push(match[2]);
 styleOptions(unit,units.map(v=>[v,v||t('tokenUnitless')]));
 unit.value=match?.[2]??units[0];if(unit.value===''&&!units.includes(''))unit.value=units[0];
 number.id=controlId;number.type='number';number.step=key==='font-weight'?'1':'any';number.value=match?.[1]??'';number.placeholder=t('sectionInherit');number.dataset.styleProperty=key;
 if(!['letter-spacing','margin-inline','margin-block'].includes(key))number.min=key==='font-weight'?'1':'0';
 if(key==='font-weight')number.max='1000';
 const input=()=>changed(number.value?number.value+(number.value==='0'?'':unit.value):'');
 number.oninput=input;unit.onchange=input;unit.setAttribute('aria-label',title.textContent+' · '+t('tokenUnit'));
 group.append(number);if(units.length>1)group.append(unit);label.append(group);return label;
}
