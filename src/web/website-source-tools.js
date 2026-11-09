import {formatWebsiteSource,sourceHighlight,sourceLines,sourcePoint,styleSelectorAt,fieldSourceText,fieldSourceOffset,rawSourceOffset} from './website-source-text.js';
import {websiteCSSByteLimit} from './website-css-urls.js';
import {websiteHTML} from './website-html-document.js';

export function websiteSourceTools({t,escape,state,accepted,ready,locate,select,change,access}){
 let input,kind,host,mirror,lines=[],value=null,search='',replacement='',diagnostic=null,generation=0,abort,resize,selecting=false;
 let cachedHTML=null,cachedSite=null;const locations=new Map();
 const el=q=>host?.querySelector(q);
 const say=s=>{const n=el('[data-source-note]');if(n)n.textContent=s;};
 const button=(key,cmd)=>'<button type="button" class="button" data-source-command="'+cmd+'">'+escape(t(key))+'</button>';
 function controls(){
  return '<div class="website-source-actions">'+button('sourceFind','find')+button('sourceFormat','format')+button('sourceCanvas','locate')+'</div>'+
   '<div class="website-source-search" data-source-find hidden><label>'+escape(t('sourceFind'))+'<input data-source-query></label><label>'+escape(t('sourceReplacement'))+'<input data-source-replacement></label>'+
   button('sourceNext','next')+button('sourceReplace','replace')+button('sourceReplaceAll','all')+'</div>';
 }
 const note=()=>'<div class="website-source-note"><output data-source-position></output> <span data-source-note></span> <button type="button" class="button" data-source-command="issue" hidden>'+escape(t('sourceShowIssue'))+'</button></div>';
 function stop(){generation++;abort?.abort();resize?.disconnect();input=null;host=null;value=null;diagnostic=null;cachedHTML=cachedSite=null;locations.clear();}
 function indices(){if(value!==input.value){value=input.value;lines=sourceLines(value);}return lines;}
 function position(){if(!input)return;const pt=sourcePoint(indices(),input.selectionStart);el('[data-source-position]').textContent=t('sourcePosition',pt);}
 function paint(){
  if(!input)return;indices();const height=parseFloat(getComputedStyle(input).lineHeight)||18;
  const from=Math.max(0,Math.floor(input.scrollTop/height)-1),until=Math.min(lines.length,from+Math.ceil(input.clientHeight/height)+4);
  const begin=lines[from]??0,end=lines[until]??value.length;
  // An unbroken data line can exceed the whole viewport budget. Keep native
  // text and selection visible until a highlightable range comes into view.
  const limited=end-begin>65536;
  host.toggleAttribute('data-native-source',limited);
  if(limited)mirror.replaceChildren();
  else{
   mirror.innerHTML=sourceHighlight(value.slice(begin,end),kind,escape);
   mirror.style.transform='translate('+(-input.scrollLeft)+'px,'+(from*height-input.scrollTop)+'px)';
  }
  position();
 }
 function reveal(start,end,focus=true){
  if(focus)input.focus({preventScroll:true});
  input.setSelectionRange(start,end);const {line,column}=sourcePoint(indices(),start),cs=getComputedStyle(input),h=parseFloat(cs.lineHeight)||18;
  input.scrollTop=Math.max(0,(line-1)*h-input.clientHeight/3);
  // Measure the typed line in its own font, including author tabs.
  if(column>1){const prefix=value.slice(lines[line-1],start),canvas=input.ownerDocument.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=cs.font;input.scrollLeft=Math.max(0,ctx.measureText(prefix.replace(/\t/g,'  ')).width-input.clientWidth/3);}
  else input.scrollLeft=0;
  paint();
 }
 function issue(problem){
  diagnostic=problem;const button=el('[data-source-command="issue"]');
  if(button)button.hidden=!problem||problem.kind!==kind||!Number.isInteger(problem.start);
  if(!problem){say('');return;}
  const text=state()[problem.kind];
  let label='';
  if(Number.isInteger(problem.start)){
   const point=sourcePoint(problem.kind===kind&&input?indices():sourceLines(fieldSourceText(text)),fieldSourceOffset(text,problem.start));
   label=t('sourcePosition',point)+' · '+text.slice(problem.start,Math.min(problem.end,problem.start+96))+' · ';
  }
  say(label+t('sourceReason_'+problem.reason));
 }
 async function locateHTML(query,toSource){
  abort?.abort();const controller=new AbortController();abort=controller;
  const ticket=++generation,original=state(),target=input;
  try{
   if(cachedHTML!==original.html||cachedSite!==original.site){cachedHTML=original.html;cachedSite=original.site;locations.clear();}
   const key=JSON.stringify(query);
   const result=locations.has(key)?locations.get(key):await locate(query,controller.signal);
   if(ticket!==generation||!target?.isConnected||target!==input||state().site!==original.site||state().html!==original.html||result.revision!==original.site.revision)return;
   if(locations.size>=128)locations.delete(locations.keys().next().value);
   locations.set(key,result);
   const loc=result.location;
   if(!loc){say(t('sourceNoMatch'));return;}
   const tag=original.html.slice(loc.start,loc.tagEnd).match(/^<[^\s/>]+/)?.[0]??'';
   say((loc.protectedRegion?t('sourceProtected')+' · ':'')+tag+(tag?'>':''));
   if(toSource)reveal(fieldSourceOffset(original.html,loc.start),fieldSourceOffset(original.html,loc.tagEnd),false);
   else{selecting=true;try{select(loc.path);}finally{selecting=false;}}
  }catch(e){if(!controller.signal.aborted&&ticket===generation){if(access(e))return;say(e.message);}}
 }
 function fromCanvas(path){
  if(input?.isConnected&&kind==='html'&&!selecting&&path&&input.ownerDocument.activeElement!==input)void locateHTML({path},true);
 }
 function cssTargets(move=false){
  const selector=styleSelectorAt(input.value,input.selectionStart);if(!selector){if(move)say(t('sourceNoMatch'));return;}
  const doc=elCanvas()??websiteHTML(accepted().html);let nodes;
  try{nodes=doc.querySelectorAll(selector);}catch{say(t('sourceNoMatch'));return;}
  let node;for(const item of nodes){if(doc.body.contains(item)&&!item.closest('[data-observanda-editor]')){node=item;break;}}
  if(!node){say(t('sourceNoMatch'));return;}
  say(t('sourceMatch',{selector,count:nodes.length,element:node.localName+(node.id?'#'+node.id:'')}));
  if(move){
   const steps=[];for(let n=node;n&&n!==doc.body;n=n.parentElement)steps.push(Array.prototype.indexOf.call(n.parentElement.children,n));
   select(steps.reverse().join('/'));
  }
 }
 const elCanvas=()=>document.getElementById('website-files-canvas')?.contentDocument;
 function find(next=true){
  if(!search)return false;
  const text=input.value,start=next?input.selectionEnd:input.selectionStart;
  let at=text.indexOf(search,start);if(at<0)at=text.indexOf(search);
  if(at<0){say(t('sourceNoMatch'));return false;}
  reveal(at,at+search.length);say('');return true;
 }
 async function command(op){
  if(op==='find'){const form=el('[data-source-find]');form.hidden=!form.hidden;if(!form.hidden)el('[data-source-query]').focus();return;}
  if(op==='issue'){if(diagnostic?.kind===kind){const raw=state()[kind];reveal(fieldSourceOffset(raw,diagnostic.start),fieldSourceOffset(raw,diagnostic.end));}return;}
  if(op==='locate'){if(!await ready())return;if(kind==='css')cssTargets(true);else void locateHTML({offset:rawSourceOffset(state().html,input.selectionStart)},false);return;}
  if(op==='next'){find();return;}
  if(op==='replace'){
   if(!search||input.value.slice(input.selectionStart,input.selectionEnd)!==search){find(false);return;}
   const at=input.selectionStart;change(kind,input.value.slice(0,at)+replacement+input.value.slice(input.selectionEnd));reveal(at,at+replacement.length);return;
  }
  if(op==='all'){
   if(!search||!input.value.includes(search)){say(t('sourceNoMatch'));return;}
   let count=0,at=0;
   while((at=input.value.indexOf(search,at))!==-1){count++;at+=search.length;}
   if(input.value.length+count*(replacement.length-search.length)>websiteCSSByteLimit){say(t('sourceSize'));return;}
   change(kind,input.value.replaceAll(search,()=>replacement));return;
  }
  if(op==='format'){
   const target=input;if(!await ready()||input!==target)return;
   const raw=input.value,formatted=formatWebsiteSource(raw,kind);
   if(formatted===null||formatted.length>websiteCSSByteLimit){say(t('sourceSize'));return;}
   if(kind==='html'&&websiteHTML(raw).documentElement.outerHTML!==websiteHTML(formatted).documentElement.outerHTML){say(t('sourceFormatSkipped'));return;}
   if(formatted!==raw){change(kind,formatted);say(t('sourceFormatted'));}return;
  }
 }
 function bind(){
  resize?.disconnect();abort?.abort();generation++;input=document.querySelector('[data-source-input]');if(!input){host=null;return;}
  host=input.closest('.website-source-pane');kind=input.dataset.sourceInput;value=null;mirror=el('[data-source-highlight]');
  const source=fieldSourceText(state()[kind]);if(input.value!==source)input.value=source;
  el('[data-source-query]').value=search;el('[data-source-replacement]').value=replacement;
  host.onclick=e=>{const action=e.target.closest('[data-source-command]');if(action)void command(action.dataset.sourceCommand).catch(error=>say(error.message));};
  host.oninput=e=>{if(e.target===input)paint();if(e.target.matches('[data-source-query]'))search=e.target.value;if(e.target.matches('[data-source-replacement]'))replacement=e.target.value;};
  host.onkeydown=e=>{
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();el('[data-source-find]').hidden=false;el('[data-source-query]').focus();}
   if(e.key==='Enter'&&e.target.matches('[data-source-query]')){e.preventDefault();find();}
  };
  input.onscroll=paint;input.onselect=position;
  input.onkeyup=e=>{position();if(kind==='css'&&!diagnostic&&['Home','End','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))cssTargets();};
  input.onclick=()=>{position();if(kind==='css'&&!diagnostic)cssTargets();};
  resize=new ResizeObserver(paint);resize.observe(input);paint();issue(diagnostic);
 }
 return {controls,note,bind,paint,issue,stop,fromCanvas,cssTargets:()=>{if(input&&kind==='css')cssTargets();}};
}
