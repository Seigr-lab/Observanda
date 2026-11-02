const widths={desktop:null,tablet:900,phone:600};
const namePattern=/^ow-layout-[a-f0-9-]{36}$/;
const valueLabels={block:'layoutBlock',flex:'layoutFlex',grid:'layoutGrid',row:'layoutRow',column:'layoutColumn','row-reverse':'layoutReverseRow','column-reverse':'layoutReverseColumn',nowrap:'layoutNoWrap',wrap:'layoutWrapLines','wrap-reverse':'layoutReverseWrap','row dense':'layoutDenseRows','column dense':'layoutDenseColumns',stretch:'layoutStretch',start:'sectionStart',center:'sectionCenter',end:'sectionEnd',baseline:'layoutBaseline','space-between':'layoutBetween','space-around':'layoutAround','space-evenly':'layoutEvenly',none:'layoutNone',solid:'layoutSolid',dashed:'layoutDashed',dotted:'layoutDotted',double:'layoutDouble'};
const fields=[
 ['display','layoutDisplay',['block','flex','grid']],
 ['flex-direction','layoutDirection',['row','column','row-reverse','column-reverse']],
 ['flex-wrap','layoutWrap',['nowrap','wrap','wrap-reverse']],
 ['grid-template-columns','layoutColumns','columns'],
 ['grid-auto-flow','layoutFlow',['row','column','row dense','column dense']],
 ['align-items','layoutAlign',['stretch','start','center','end','baseline']],
 ['justify-content','layoutJustify',['start','center','end','space-between','space-around','space-evenly']],
 ['gap','layoutGap','pair'],['padding','sectionPadding','box'],
 ['width','layoutWidth','size'],['min-width','layoutMinWidth','size'],['max-width','layoutMaxWidth','limit'],
 ['flex-basis','layoutBasis','size'],['border-width','layoutBorderWidth','box'],
 ['border-style','layoutBorderStyle',['none','solid','dashed','dotted','double']],
 ['border-color','layoutBorderColor','color'],['border-radius','layoutRadius','box']
];
const lengths=/^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vw|vh|ch))$/i;
function valueFor(type,value,property,win){
 const parts=value.split(/\s+/);
 if(Array.isArray(type))return type.includes(value)?value:null;
 if(type==='columns')return /^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))?'repeat('+value+', minmax(0, 1fr))':null;
 if(type==='color')return /^(?:#[0-9a-f]{3,8}|[a-z]+)$/i.test(value)&&win.CSS.supports(property,value)?value:null;
 if((type==='size'||type==='limit')&&['auto','fit-content','min-content','max-content',...(type==='limit'?['none']:[])].includes(value))return win.CSS.supports(property,value)?value:null;
 return parts.length<=(type==='box'?4:type==='pair'?2:1)&&parts.every(v=>lengths.test(v))&&win.CSS.supports(property,value)?value:null;
}
function boundaries(css,name){
 if(name!=='site'&&!namePattern.test(name))throw new TypeError('Unexpected layout style');
 const start='\n/* Observanda layout '+name+' */\n',end='\n/* End Observanda layout '+name+' */\n';
 const at=css.indexOf(start),until=at===-1?-1:css.indexOf(end,at+start.length);
 if(at!==-1&&(until===-1||css.indexOf(start,at+start.length)!==-1))throw new TypeError('Ambiguous layout style');
 return {start,end,at,until,text:at===-1?'':css.slice(at+start.length,until)};
}
function styleAt(document,block,view){
 const style=document.createElement('div').style,tag='/* '+view+' */',line=block.split('\n').find(line=>line.startsWith(tag));
 if(line){const body=line.match(/\{([^{}]*)\}\s*\}?$/);if(!body)throw new TypeError('Unexpected layout rule');style.cssText=body[1];}
 return style;
}
function update(css,name,view,style){
 const block=boundaries(css,name),selector=name==='site'?'body':'.'+name+'.'+name,lines=block.text?block.text.split('\n'):[];
 const others=new Map();
 for(const line of lines){
  const key=/^\/\* (desktop|tablet|phone) \*\//.exec(line)?.[1];
  if(!key||others.has(key))throw new TypeError('Unexpected layout rule');others.set(key,line);
 }
 if(style.length){
  const rule=selector+' {'+style.cssText+'}',max=widths[view];
  others.set(view,'/* '+view+' */'+(max?'@media (max-width: '+max+'px) {'+rule+'}':rule));
 }else others.delete(view);
 const replacement=others.size?block.start+Object.keys(widths).filter(key=>others.has(key)).map(key=>others.get(key)).join('\n')+block.end:'';
 return block.at===-1?css+replacement:css.slice(0,block.at)+replacement+css.slice(block.until+block.end.length);
}
export function responsiveLayout({document,host,t,scope,selected,getCSS,getViewport,beforeChange,change,write,make,listen}){
 const panel=make('details');panel.className='website-layout-inspector';const summary=make('summary',t('layoutTitle'));panel.append(summary);
 const device=make('p'),hint=make('p',t('layoutHint')),grid=make('div');grid.className='website-visual-fields';
 const controls=new Map(),touched=new Set();
 for(const [property,label,type] of fields){
  const control=make(Array.isArray(type)?'select':'input');control.dataset.layoutProperty=property;
  if(Array.isArray(type)){
   for(const value of ['',...type]){
    const option=make('option',t(value?valueLabels[value]:'sectionInherit'));option.value=value;control.append(option);
   }
  }else if(type==='columns'){control.type='number';control.min='1';control.step='1';}
  const wrap=make('label');wrap.append(make('span',t(label)),control);grid.append(wrap);controls.set(property,control);
  const touch=()=>{control.setCustomValidity('');touched.add(property);apply.disabled=false;};
  listen(control,'input',touch);listen(control,'change',touch);
 }
 const apply=make('button',t('layoutApply')),reset=make('button',t('layoutReset'));apply.type=reset.type='button';
 const actions=make('div');actions.className='website-visual-actions';actions.append(apply,reset);panel.append(device,hint,grid,actions);host.append(panel);
 function target(){return scope.value==='section'?selected():['page','site'].includes(scope.value)?document.body:null;}
 const identifier=node=>scope.value==='site'?'site':[...node.classList].find(name=>namePattern.test(name));
 const breakpoint=()=>{const view=getViewport?.()??'desktop';if(!Object.hasOwn(widths,view))throw new TypeError('Unexpected viewport');return view;};
 function refresh(){
  const node=target(),view=breakpoint();panel.hidden=!node||!!node.closest('[data-observanda-link],[data-website-instance]');
  touched.clear();apply.disabled=true;
  if(panel.hidden||!panel.open)return;
  const name=identifier(node),block=name?boundaries(getCSS(),name).text:'',style=styleAt(document,block,view);
  const computed=document.defaultView.getComputedStyle(node);reset.disabled=!style.length;
  device.textContent=t(view==='desktop'?'layoutDesktop':view==='tablet'?'layoutTablet':'layoutPhone');
  for(const [property,,type] of fields){
   const control=controls.get(property),existing=style.getPropertyValue(property);
   control.setCustomValidity('');control.value=type==='columns'?(/^repeat\((\d+),/.exec(existing)?.[1]??''):existing;
   if(!Array.isArray(type))control.placeholder=type==='columns'?t('sectionInherit'):computed.getPropertyValue(property);
  }
 }
 function commit(clear){
  const node=target(),view=breakpoint();if(!node||panel.hidden||!clear&&!touched.size)return;
  const prior=identifier(node);if(clear&&!prior)return;
  const name=prior??'ow-layout-'+crypto.randomUUID(),current=getCSS(),style=styleAt(document,boundaries(current,name).text,view);
  if(clear)style.cssText='';
  else for(const [property,,type] of fields){
   if(!touched.has(property))continue;
   const control=controls.get(property),text=control.value.trim();
   if(!text){style.removeProperty(property);continue;}
   const value=valueFor(type,text,property,document.defaultView);
   if(value===null){control.setCustomValidity(t('layoutInvalid'));control.reportValidity();return;}
   style.setProperty(property,value);
  }
  const next=update(current,name,view,style);if(current===next){refresh();return;}
  beforeChange();if(scope.value!=='site'){
   if(boundaries(next,name).text)node.classList.add(name);else node.classList.remove(name);
   change();
  }
  write(next,css=>update(css,name,view,style));refresh();
 }
 // A details toggle is delivered in a later task. A user can change a
 // control before the opening event arrives. Keep those pending edits.
 listen(panel,'toggle',()=>{if(!panel.open||!touched.size)refresh();});
 listen(apply,'click',()=>commit(false));listen(reset,'click',()=>commit(true));
 listen(panel,'keydown',event=>{if(event.key==='Enter'&&event.target.matches('input')){event.preventDefault();commit(false);}});
 return {refresh};
}
