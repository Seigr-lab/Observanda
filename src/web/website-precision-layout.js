import {precisionArrangement,precisionChildren,precisionEdit,precisionEligible,precisionPlane,precisionStackingOwner} from './website-precision-geometry.js';
import {precisionHandles} from './website-precision-handles.js';
import {inspectWebsiteStyle} from './website-style-inspection.js';

export function websitePrecisionLayout({root,document,make,listen,t,selected,selectNode,applyNodes,breakpoint,matchesPreview,childName,signal}){
 const details=make('details'),summary=make('summary',t('precisionLayout'));details.append(summary);root.append(details);
 const status=make('p'),context=make('output'),group=make('fieldset'),legend=make('legend',t('precisionObjects'));
 status.setAttribute('role','status');group.append(legend);details.append(context,make('p',t('precisionHelp')),group);
 const button=(parent,key,fn)=>{const el=make('button',t(key));el.type='button';listen(el,'click',fn);parent.append(el);return el;};
 const field=(parent,key,input)=>{const label=make('label');label.append(make('span',t(key)),input);parent.append(label);return input;};
 const input=(parent,key,type)=>{const el=make('input');el.type=type;return field(parent,key,el);};
 const number=(parent,key,value,min)=>{const el=input(parent,key,'number');el.step='any';el.required=true;el.value=value;if(min!==undefined)el.min=min;return el;};
 const select=(parent,key,choices)=>{const el=field(parent,key,make('select'));for(const [id,msg] of choices){const o=make('option',t(msg));o.value=id;el.append(o);}return el;};
 const actions=make('div');actions.className='website-visual-actions';group.append(actions);
 let nodes=new Set(),anchor=null,parent=null,offset=0,focus=null,lastRange,items=[];
 const shown=()=>{for(let n=details;n;n=n.parentElement)if(n.hidden||n.tagName==='DETAILS'&&!n.open)return false;return details.isConnected;};
 const active=()=>shown()&&anchor?.isConnected?[...nodes].filter(n=>n.isConnected):[];
 const report=key=>{status.textContent=t(key);};
 function commit(changes){
  if(!changes.length||changes.some(({node})=>!precisionEligible(node)))return report('precisionProtected');
  if(!applyNodes(changes,undefined,override.checked?'important':''))return report('layoutAreaSize');
  report('layoutApplied');handles.schedule();syncControls();
  if(!matchesPreview())return;
  const {node,properties}=changes[0],actual=document.defaultView.getComputedStyle(node);
  for(const [key,wanted] of Object.entries(properties)){
   if(typeof wanted!=='string'||!/^\d+(?:\.\d+)?px$/.test(wanted)||Math.abs(parseFloat(actual.getPropertyValue(key))-parseFloat(wanted))<.05)continue;
   if(!Number.isFinite(parseFloat(actual.getPropertyValue(key))))continue;
   const source=inspectWebsiteStyle(node,key);
   status.textContent=t('precisionCascade',{property:key,value:actual.getPropertyValue(key),source:source?.selector||t('sectionInherit')});break;
  }
 }
 button(actions,'precisionParent',()=>{const owner=anchor?.parentElement;if(precisionEligible(owner))selectNode(owner);});
 button(actions,'precisionPeers',()=>{if(!anchor)return;nodes=new Set(precisionChildren(anchor.parentElement));paint();});
 button(actions,'precisionChildren',()=>{
  const all=precisionChildren(anchor);if(!all.length)return report('precisionSelection');
  selectNode(all[0]);anchor=all[0];parent=anchor.parentElement;nodes=new Set(all);paint();
 });
 const filter=input(group,'precisionFind','search'),list=make('div');group.append(list);
 const pager=make('div');pager.className='website-visual-actions';group.append(pager);
 const prev=button(pager,'pageBack',()=>{offset=Math.max(0,offset-20);drawList();}),range=make('output');pager.append(range);
 const next=button(pager,'pageForward',()=>{offset+=20;drawList();});
 listen(filter,'input',()=>{offset=0;buildList();drawList();});
 function buildList(){
  const term=filter.value.trim().toLocaleLowerCase();
  items=precisionChildren(parent).filter(n=>!term||childName(n).toLocaleLowerCase().includes(term));
 }
 function drawList(){
  offset=Math.max(0,Math.min(offset,Math.max(0,Math.floor((items.length-1)/20)*20)));
  list.replaceChildren();for(const n of items.slice(offset,offset+20)){
   const box=make('input');box.type='checkbox';box.checked=nodes.has(n);const label=make('label');label.append(box,' ',childName(n));list.append(label);
   box.onchange=()=>{if(box.checked)nodes.add(n);else nodes.delete(n);syncControls();handles.sync();};
  }
  prev.disabled=offset===0;next.disabled=offset+20>=items.length;
  range.textContent=(items.length?offset+1:0)+'–'+Math.min(offset+20,items.length)+' / '+items.length;
 }
 const align=make('fieldset'),controls=make('div');controls.className='website-visual-fields';align.append(make('legend',t('precisionArrangement')),controls);details.append(align);
 const kind=select(controls,'precisionOperation',[['alignX','precisionAlignX'],['alignY','precisionAlignY'],['spreadX','precisionSpreadX'],['spreadY','precisionSpreadY'],['caption','precisionCaptions']]);
 const edge=select(controls,'layoutAlign',[['start','sectionStart'],['center','sectionCenter'],['end','sectionEnd']]);
 listen(kind,'change',()=>{edge.disabled=kind.value.startsWith('spread');});
 button(align,'precisionApplyGroup',()=>{const result=precisionArrangement(active(),kind.value,edge.value);if(result.reason)report(result.reason);else commit(result.changes);});
 const box=make('fieldset'),dims=make('div');dims.className='website-visual-fields';box.append(make('legend',t('precisionDimensions')),dims);details.append(box);
 const size=select(dims,'precisionOperation',[['width','layoutWidth'],['height','precisionHeight'],['padding','sectionPadding'],['gap','layoutGapPx'],['move','precisionMove']]);
 const first=number(dims,'precisionValue','0',0),second=number(dims,'layoutY','0',0);
 const snapping=input(dims,'precisionSnap','checkbox');snapping.checked=true;
 const override=input(details,'precisionOverride','checkbox');
 const step=number(dims,'precisionGridStep','8','1');
 function syncControls(){
  const selection=active();focus=selection.length===1?selection[0]:null;
  if(!focus){context.textContent=t('precisionSelected',{count:selection.length});box.disabled=true;return;}
  const p=precisionPlane(focus);box.disabled=!!p.reason;
  if(p.reason){context.textContent=t(p.reason);return;}
  const ownerName=p.containing?childName(p.containing):t('viewport'),layer=p.style.zIndex==='auto'?t('sectionInherit'):p.style.zIndex;
  const stack=precisionStackingOwner(focus);
  context.textContent=t('precisionContext',{name:childName(focus),parent:ownerName,layer,stack:stack?childName(stack):t('viewport'),width:Math.round(p.rect.width),height:Math.round(p.rect.height)});
  second.parentElement.hidden=size.value!=='move';
  const value=size.value==='move'?p.x:size.value==='width'||size.value==='height'?p.rect[size.value]:parseFloat(p.style[size.value==='gap'?'columnGap':'paddingLeft']);
  first.value=Number.isFinite(value)?String(Math.round(value*100)/100):'0';second.value=String(Math.round(p.y*100)/100);
 }
 listen(size,'change',syncControls);
 button(box,'precisionApplySize',()=>{
  if(!focus||!first.reportValidity()||size.value==='move'&&!second.reportValidity())return;
  const update=precisionEdit(precisionPlane(focus),size.value,[first.valueAsNumber,second.valueAsNumber]);
  if(update.reason)report(update.reason);else commit([{node:focus,properties:update.properties}]);
 });
 details.append(status);
 const handles=precisionHandles({document,selection:active,settings:()=>({snapTo:snapping.checked,step:Math.max(1,step.valueAsNumber||1),scope:breakpoint()}),commit,report,t,signal});
 function paint(){buildList();drawList();syncControls();handles.sync();}
 function refresh(){
  if(!shown()){handles.reset();handles.sync();return;}
  const node=selected(),view=breakpoint();
  if(anchor===node&&lastRange===view){handles.schedule();return;}
  lastRange=view;status.textContent='';handles.reset();
  if(anchor!==node){anchor=node;parent=node?.parentElement;nodes=new Set(precisionEligible(node)?[node]:[]);offset=0;filter.value='';}
  paint();
 }
 listen(details,'toggle',()=>{if(details.open){anchor=null;refresh();}else{handles.reset();handles.sync();}});
 for(let ancestor=details.parentElement;ancestor;ancestor=ancestor.parentElement)if(ancestor.tagName==='DETAILS')listen(ancestor,'toggle',refresh);
 listen(document,'click',event=>{
  if(!shown()||!event.shiftKey||!parent)return;
  let item=event.target;while(item&&item.parentElement!==parent)item=item.parentElement;
  if(!precisionEligible(item))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(nodes.has(item))nodes.delete(item);else nodes.add(item);drawList();syncControls();handles.sync();
 },{capture:true});
 return {refresh};
}
