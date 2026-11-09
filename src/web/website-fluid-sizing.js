const units=['px','rem','em','vw','vh','%','ch'];
const dimension=/^((?:\d+(?:\.\d+)?|\.\d+))(px|rem|em|vw|vh|%|ch)$/i;

export function websiteFluidSizing({fields,controls,t,make,listen,touch}){
 const details=make('details'),choose=make('select'),values=[];
 let owner,range,loadedKey;
 details.className='website-fluid-sizing';details.append(make('summary',t('breakpointFluid')));
 const property=make('label');property.append(make('span',t('tokenProperty')),choose);details.append(property);
 for(const [key,label,type] of fields){
  if(!['size','limit','pair','box'].includes(type))continue;
  const option=make('option',t(label));option.value=key;choose.append(option);
 }
 const dimensions=make('div');dimensions.className='website-visual-fields';details.append(dimensions);
 for(const [key,preferred] of [['breakpointFluidMinimum','px'],['breakpointFluidPreferred','vw'],['breakpointFluidMaximum','px']]){
  const group=make('div'),label=make('label'),value=make('input'),unit=make('select');
  group.className='website-fluid-dimension';label.append(make('span',t(key)),value);group.append(label,unit);dimensions.append(group);
  value.type='number';value.min='0';value.step='any';value.required=true;unit.setAttribute('aria-label',t('breakpointFluidUnit',{bound:t(key)}));
  for(const text of units){const option=make('option',text);option.value=text;unit.append(option);}
  unit.value=preferred;values.push({value,unit});
 }
 const use=make('button',t('breakpointFluidUse'));use.type='button';details.append(use);
 function refresh(currentOwner=owner,currentRange=range){
  const control=controls.get(choose.value),key=choose.value+'\n'+control.value;
  if(currentOwner===owner&&range===currentRange&&key===loadedKey)return;
  owner=currentOwner;range=currentRange;loadedKey=key;
  const clamp=/^clamp\(([^()]*)\)$/.exec(control.value.trim());
  const parts=clamp?.[1].split(',').map(part=>dimension.exec(part.trim()));
  const current=parts?.length===3&&parts.every(Boolean)?parts.map(match=>[match[1],match[2]]):[['8','px'],['2','vw'],['32','px']];
  values.forEach(({value,unit},i)=>{value.setCustomValidity('');value.value=current[i][0];unit.value=current[i][1];});
 }
 function accept(){
  for(const {value} of values)if(!value.reportValidity())return;
  const [min,,max]=values;
  if(min.unit.value===max.unit.value&&min.value.valueAsNumber>max.value.valueAsNumber){
   max.value.setCustomValidity(t('breakpointFluidInvalid'));max.value.reportValidity();return;
  }
  const key=choose.value,control=controls.get(key);
  control.value='clamp('+values.map(({value,unit})=>value.value+unit.value).join(', ')+')';touch(key);
 }
 listen(choose,'change',()=>refresh());listen(use,'click',accept);
 listen(dimensions,'input',()=>values.forEach(({value})=>value.setCustomValidity('')));
 return {details,refresh};
}
