import {websiteLayoutComposer,layoutProtected} from './website-layout-composer.js';
import {websiteCSSByteLimit} from './website-css-urls.js';
import {breakpointCondition,breakpointLabel,defaultBreakpoints,layoutDeclarations,layoutEnd,layoutStart,managedLayoutBlocks,matchesWidth,orderedLayoutLines} from './website-breakpoint-model.js';
import {inspectWebsiteStyle} from './website-style-inspection.js';
import {websiteFluidSizing} from './website-fluid-sizing.js';
const namePattern=/^ow-layout-[a-f0-9-]{36}$/;
const valueLabels={block:'layoutBlock',flex:'layoutFlex',grid:'layoutGrid',row:'layoutRow',column:'layoutColumn','row-reverse':'layoutReverseRow','column-reverse':'layoutReverseColumn',nowrap:'layoutNoWrap',wrap:'layoutWrapLines','wrap-reverse':'layoutReverseWrap','row dense':'layoutDenseRows','column dense':'layoutDenseColumns',stretch:'layoutStretch',start:'sectionStart',center:'sectionCenter',end:'sectionEnd',baseline:'layoutBaseline','space-between':'layoutBetween','space-around':'layoutAround','space-evenly':'layoutEvenly',none:'layoutNone',solid:'layoutSolid',dashed:'layoutDashed',dotted:'layoutDotted',double:'layoutDouble'};
const fields=[
 ['display','layoutDisplay',['block','flex','grid','none']],
 ['visibility','breakpointVisibility',['visible','hidden']],['order','breakpointOrder','order'],
 ['flex-direction','layoutDirection',['row','column','row-reverse','column-reverse']],
 ['flex-wrap','layoutWrap',['nowrap','wrap','wrap-reverse']],
 ['grid-template-columns','layoutColumns','columns'],
 ['grid-auto-flow','layoutFlow',['row','column','row dense','column dense']],
 ['align-items','layoutAlign',['stretch','start','center','end','baseline']],
 ['justify-content','layoutJustify',['start','center','end','space-between','space-around','space-evenly']],
 ['gap','layoutGap','pair'],['padding','sectionPadding','box'],
 ['width','layoutWidth','size'],['min-width','layoutMinWidth','size'],['max-width','layoutMaxWidth','limit'],
 ['flex-basis','layoutBasis','size'],['flex-grow','layoutGrow','factor'],['justify-self','layoutSelf',['stretch','start','center','end']],
 ['border-width','layoutBorderWidth','box'],
 ['border-style','layoutBorderStyle',['none','solid','dashed','dotted','double']],
 ['border-color','layoutBorderColor','color'],['border-radius','layoutRadius','box']
];
const lengths=/^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vw|vh|ch))$/i;
function valueFor(type,value,property,win){
 const parts=value.match(/clamp\([^()]*\)|[^\s]+/g)??[];
 if(Array.isArray(type))return type.includes(value)?value:null;
 if(type==='columns')return /^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))?'repeat('+value+', minmax(0, 1fr))':null;
 if(type==='factor')return value!==''&&Number.isFinite(Number(value))&&Number(value)>=0&&win.CSS.supports(property,value)?value:null;
 if(type==='order')return /^-?(?:0|[1-9]\d*)$/.test(value)&&Number.isSafeInteger(Number(value))&&win.CSS.supports(property,value)?value:null;
 if(type==='color')return /^(?:#[0-9a-f]{3,8}|[a-z]+)$/i.test(value)&&win.CSS.supports(property,value)?value:null;
 if((type==='size'||type==='limit')&&['auto','fit-content','min-content','max-content',...(type==='limit'?['none']:[])].includes(value))return win.CSS.supports(property,value)?value:null;
 const dimension=part=>lengths.test(part)||/^clamp\(([^(),]+),\s*([^(),]+),\s*([^(),]+)\)$/.test(part)&&part.slice(6,-1).split(',').every(v=>lengths.test(v.trim()));
 return parts.length>0&&parts.length<=(type==='box'?4:type==='pair'?2:1)&&parts.every(dimension)&&win.CSS.supports(property,value)?value:null;
}
function boundaries(css,name){
 if(name!=='site'&&!namePattern.test(name))throw new TypeError('Unexpected layout style');
 const block=managedLayoutBlocks(css).get(name);
 return {start:layoutStart(name),end:layoutEnd(name),at:block?.from??-1,until:block?block.to-layoutEnd(name).length:-1,text:block?.body??''};
}
function styleAt(document,block,view,ranges,name){
 const style=document.createElement('div').style;
 if(block){
  const declarations=layoutDeclarations({body:block,name},ranges);if(!declarations)throw TypeError('Custom layout rule');
  style.cssText=declarations.get(view)??'';
 }
 return style;
}
function update(css,name,view,style,ranges){
 const block=boundaries(css,name),others=block.text?layoutDeclarations({body:block.text,name},ranges):new Map();
 if(!others)throw TypeError('Custom layout rule');
 if(style.length)others.set(view,style.cssText);else others.delete(view);
 const replacement=others.size?block.start+orderedLayoutLines(others,name,ranges)+block.end:'';
 return block.at===-1?css+replacement:css.slice(0,block.at)+replacement+css.slice(block.until+block.end.length);
}
export function responsiveLayout({document,host,before,t,scope,selected,selectNode,getCSS,getViewport,getWidth,previewWidth,getRanges=defaultBreakpoints,manageRanges,beforeChange,change,write,make,listen,signal}){
 const panel=make('details');panel.className='website-layout-inspector';const summary=make('summary',t('layoutTitle'));panel.append(summary);
 const device=make('p'),hint=make('p',t('layoutHint')),grid=make('div');grid.className='website-visual-fields';
 const tools=make('div'),rangeLabel=make('label'),rangeSelect=make('select'),manage=make('button',t('breakpointManage'));
 const trace=make('details'),traceTitle=make('summary',t('breakpointInspect')),propertyLabel=make('label'),propertyChoice=make('select'),provenance=make('output');
 tools.className='website-breakpoint-tools';manage.type='button';manage.hidden=!manageRanges;rangeSelect.dataset.layoutRange='';
 rangeLabel.append(make('span',t('breakpointEditing')),rangeSelect);tools.append(rangeLabel,manage);
 propertyLabel.append(make('span',t('tokenProperty')),propertyChoice);trace.append(traceTitle,propertyLabel,provenance);provenance.setAttribute('aria-live','polite');
 const controls=new Map(),touched=new Set();let mode='',rangeKey='',customRule=false;
 const labelFor=(range)=>range.id==='desktop'?t('layoutDesktop'):breakpointLabel(range,t)+' · '+breakpointCondition(range);
 for(const [property,label,type] of fields){
  const inspectOption=make('option',t(label));inspectOption.value=property;propertyChoice.append(inspectOption);
  const control=make(Array.isArray(type)?'select':'input');control.dataset.layoutProperty=property;
  if(Array.isArray(type)){
   for(const value of ['',...type]){
    const option=make('option',t(value?(value==='visible'?'breakpointVisible':value==='hidden'?'breakpointHidden':valueLabels[value]):'sectionInherit'));option.value=value;control.append(option);
   }
  }else if(type==='columns'){control.type='number';control.min='1';control.step='1';}
  const wrap=make('label');wrap.append(make('span',t(label)),control);grid.append(wrap);controls.set(property,control);
  const touch=()=>{control.setCustomValidity('');touched.add(property);apply.disabled=false;};
  listen(control,'input',touch);listen(control,'change',touch);
 }
 const apply=make('button',t('layoutApply')),reset=make('button',t('layoutReset'));apply.type=reset.type='button';
 const fluid=websiteFluidSizing({fields,controls,t,make,listen,touch:key=>{controls.get(key).setCustomValidity('');touched.add(key);commit(false);}});
 const actions=make('div');actions.className='website-visual-actions';actions.append(apply,reset);panel.append(tools,device,hint,grid,fluid.details,actions,trace);host.insertBefore(panel,before??null);
 function target(){return scope.value==='section'?selected():['page','site'].includes(scope.value)?document.body:null;}
 const identifier=node=>scope.value==='site'?'site':[...node.classList].find(name=>namePattern.test(name));
 const width=()=>getWidth?.()??document.defaultView.innerWidth;
 const breakpoint=()=>mode||(!getWidth&&getViewport?getViewport():getRanges().findLast(r=>matchesWidth(r,width()))?.id??'desktop');
 const nodeClass=node=>[...node.classList].find(x=>namePattern.test(x));
 const styles=()=>{const blocks=managedLayoutBlocks(getCSS()),view=breakpoint(),ranges=getRanges();return node=>styleAt(document,blocks.get(nodeClass(node))?.body??'',view,ranges,nodeClass(node));};
 function applyNodes(changes,mutate,priority=''){
  const view=breakpoint(),current=getCSS(),read=styles(),rules=new Map();
  const counts=new Map();
  for(const el of document.querySelectorAll('[class*="ow-layout-"]')){const name=nodeClass(el);if(name)counts.set(name,(counts.get(name)??0)+1);}
  for(const {node,properties} of changes){
   if(node.closest(layoutProtected))return false;
   const prior=nodeClass(node),name=prior&&counts.get(prior)===1?prior:'ow-layout-'+crypto.randomUUID(),style=read(node);
   for(const [property,value] of Object.entries(properties))if(value===null)style.removeProperty(property);else style.setProperty(property,value,priority||style.getPropertyPriority(property));
   rules.set(name,{node,prior,name,style});
  }
  const transform=css=>{
   const chunks=[],blocks=managedLayoutBlocks(css),ranges=getRanges();let from=0;
   for(const [name,block] of blocks){
    const rule=rules.get(name);if(!rule)continue;
    chunks.push(css.slice(from,block.from),update(css.slice(block.from,block.to),name,view,rule.style,ranges));from=block.to;
   }
   chunks.push(css.slice(from));
   for(const {name,prior,style} of rules.values())if(!blocks.has(name)){
    const source=blocks.get(prior),base=source?css.slice(source.from,source.to).replaceAll(prior,name):'';
    chunks.push(update(base,name,view,style,ranges));
   }
   return chunks.join('');
  };
  const next=transform(current);if(next===current)return true;
  if(next.length>websiteCSSByteLimit||next.length>websiteCSSByteLimit/4&&new TextEncoder().encode(next).byteLength>websiteCSSByteLimit)return false;
  const retained=managedLayoutBlocks(next);
  beforeChange();
  mutate?.();
  for(const {node,prior,name} of rules.values()){
   if(prior&&prior!==name)node.classList.remove(prior);
   node.classList.toggle(name,retained.has(name));
  }
  change();write(next,transform);refresh();return true;
 }
 const matchesPreview=()=>breakpoint()==='desktop'||getRanges().some(r=>r.id===breakpoint()&&matchesWidth(r,width()));
 const composer=websiteLayoutComposer({panel,before:hint,document,make,listen,t,selected:()=>scope.value==='section'?selected():null,selectNode,styles,applyNodes,breakpoint,matchesPreview,signal});
 function inspect(){
  const node=target();if(!node||!trace.open)return;
  const property=propertyChoice.value,actual=inspectWebsiteStyle(node,property),ranges=getRanges();
  const source=[...(actual?.conditions??[]),actual?.selector??t('tokenSource_default')].join(' · ');
  const currentName=labelFor(ranges.find(r=>r.id===breakpoint())??{id:'desktop'});
  provenance.textContent=t('breakpointEffective',{width:width(),value:actual?.value??'',source,scope:currentName});
 }
 function showRanges(ranges){
  const key=JSON.stringify(ranges);if(key===rangeKey)return;rangeKey=key;
  if(mode&&mode!=='desktop'&&!ranges.some(r=>r.id===mode))mode='';
  const opts=[['',t('breakpointAutomatic')],['desktop',t('layoutDesktop')],...ranges.map(r=>[r.id,labelFor(r)])];
  rangeSelect.replaceChildren(...opts.map(([id,label])=>{const o=make('option',label);o.value=id;return o;}));rangeSelect.value=mode;
 }
 function refresh(){
  const ranges=getRanges();showRanges(ranges);
  const node=target(),view=breakpoint();panel.hidden=!node||!!node.closest(layoutProtected);
  touched.clear();apply.disabled=true;
  if(panel.hidden||!panel.open){composer.refresh();return;}
  const name=identifier(node);let style=document.createElement('div').style;
  try{if(name)style=styleAt(document,boundaries(getCSS(),name).text,view,ranges,name);customRule=false;composer.refresh();}
  catch{customRule=true;}
  const authored=/@(media|container)\b/.test(getCSS());hint.textContent=t(customRule?'breakpointManualBlock':authored?'breakpointAuthoredHint':'layoutHint');
  grid.inert=fluid.details.inert=customRule;panel.querySelector('.website-layout-composer').inert=customRule;
  const computed=document.defaultView.getComputedStyle(node);reset.disabled=!style.length;
  device.textContent=labelFor(ranges.find(r=>r.id===view)??{id:'desktop'});
  for(const [property,,type] of fields){
   const control=controls.get(property),existing=style.getPropertyValue(property);
   control.setCustomValidity('');control.value=type==='columns'?(/^repeat\((\d+),/.exec(existing)?.[1]??''):existing;
   if(!Array.isArray(type))control.placeholder=type==='columns'?t('sectionInherit'):computed.getPropertyValue(property);
  }
  fluid.refresh(node,view);inspect();
 }
 function commit(clear){
  const node=target(),view=breakpoint();if(!node||panel.hidden||!clear&&!touched.size)return;
  const prior=identifier(node);if(clear&&!prior)return;
  if(customRule)return;
  const shared=scope.value==='section'&&prior&&document.getElementsByClassName(prior).length>1;
  const name=shared||!prior?'ow-layout-'+crypto.randomUUID():prior,current=getCSS(),ranges=getRanges(),source=prior??name;
  const style=styleAt(document,boundaries(current,source).text,view,ranges,source);
  if(clear)style.cssText='';
  else for(const [property,,type] of fields){
   if(!touched.has(property))continue;
   const control=controls.get(property),text=control.value.trim();
   if(!text){style.removeProperty(property);continue;}
   const value=valueFor(type,text,property,document.defaultView);
   if(value===null){control.setCustomValidity(t('layoutInvalid'));control.reportValidity();return;}
   style.setProperty(property,value);
  }
  const transform=css=>{
   if(!shared)return update(css,name,view,style,ranges);
   const block=managedLayoutBlocks(css).get(prior);
   const clone=block?css.slice(block.from,block.to).replaceAll(prior,name):'';
   return css+update(clone,name,view,style,ranges);
  };
  const next=transform(current);if(current===next&&!shared){refresh();return;}
  if(next.length>websiteCSSByteLimit||next.length>websiteCSSByteLimit/4&&new TextEncoder().encode(next).byteLength>websiteCSSByteLimit){
   hint.textContent=t('layoutInvalid');return;
  }
  beforeChange();if(scope.value!=='site'){
   if(shared)node.classList.remove(prior);
   node.classList.toggle(name,!!boundaries(next,name).text);
   change();
  }
  write(next,transform);refresh();
 }
 listen(manage,'click',()=>manageRanges?.());
 listen(rangeSelect,'change',()=>{
  mode=rangeSelect.value;const range=getRanges().find(r=>r.id===mode);
  if(range&&!matchesWidth(range,width()))previewWidth?.(range.max??range.min);
  refresh();
 });
 listen(trace,'toggle',inspect);listen(propertyChoice,'change',inspect);
 // A details toggle is delivered in a later task. A user can change a
 // control before the opening event arrives. Keep those pending edits.
 listen(panel,'toggle',()=>{if(!panel.open||!touched.size)refresh();});
 listen(apply,'click',()=>commit(false));listen(reset,'click',()=>commit(true));
 listen(panel,'keydown',event=>{if(event.key==='Enter'&&event.target.matches('input')){event.preventDefault();commit(false);}});
 return {refresh};
}
