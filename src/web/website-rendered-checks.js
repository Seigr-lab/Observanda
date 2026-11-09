// These checks operate on a rendered website without the editor's selection
// outlines or editable body. Ambiguous paint and interactive behavior require
// inspection of the actual published document.
const tabControls='a[href],button,input,select,textarea,summary,iframe,[contenteditable="true"],[tabindex]';
const skipped='[hidden],[inert],[aria-hidden="true"],script,style,template';
const color=value=>{
 const match=/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value);
 return match?[+match[1],+match[2],+match[3],match[4]===undefined?1:+match[4]]:null;
};
const over=(front,back)=>front.slice(0,3).map((n,i)=>n*front[3]+back[i]*(1-front[3]));
function luminance(rgb){
 const [r,g,b]=rgb.map(n=>{const v=n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
 return .2126*r+.7152*g+.0722*b;
}
function clippedText(el){
 const walk=el.ownerDocument.createTreeWalker(el,NodeFilter.SHOW_TEXT);let text='';
 for(let node=walk.nextNode();node&&text.length<95;node=walk.nextNode()){
  if(node.parentElement.closest(skipped))continue;
  text+=(text?' ':'')+node.data.trim().slice(0,95-text.length);
 }
 return text.trim().replace(/\s+/g,' ');
}
const cssVisible=el=>el.checkVisibility({opacityProperty:true,visibilityProperty:true});
export async function renderedWebsiteChecks(doc,{signal}){
 const win=doc.defaultView,paint=new WeakMap(),issues=[],keyboard=[];
 const style=node=>win.getComputedStyle(node);
 function background(node){
  if(!node)return style(doc.documentElement).colorScheme.includes('dark')?null:[255,255,255];
  if(paint.has(node))return paint.get(node);
  const s=style(node),c=color(s.backgroundColor);
  let result=null;
  if(c&&s.backgroundImage==='none'&&s.mixBlendMode==='normal'&&s.filter==='none'&&s.opacity==='1'){
   const parent=background(node.parentElement);
   if(parent)result=c[3]===1?c.slice(0,3):over(c,parent);
  }
  paint.set(node,result);return result;
 }
 const add=(key,node,detail='',manual=false)=>issues.push({key,node,detail,manual});
 const mains=[],headings=[],width=doc.documentElement.clientWidth;
 const walker=doc.createTreeWalker(doc.body,1,{acceptNode:el=>el.matches(skipped)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
 let count=0;
 for(let el=doc.body;el;el=walker.nextNode()){
  if(++count%180===0){await new Promise(resolve=>setTimeout(resolve,0));signal.throwIfAborted();}
  if(!cssVisible(el))continue;
  const bounds=el.getBoundingClientRect();
  if(!bounds.width||!bounds.height)continue;
  if(el.matches('main:not([role]),[role="main"]'))mains.push(el);
  if(el.matches('h1,[role="heading"][aria-level="1"]'))headings.push(el);
  if(el.matches('dialog,[role="dialog"],[aria-haspopup="dialog"]'))add('accessDialog',el,el.getAttribute('aria-label')||el.localName,true);
  if(el.matches('dialog,[role="dialog"]')&&!el.getAttribute('aria-label')?.trim()&&!el.getAttribute('aria-labelledby')?.trim())add('accessDialogName',el);
  if(el.matches(tabControls)&&el.tabIndex>=0&&!el.matches(':disabled')){
   const references=el.getAttribute('aria-labelledby')?.split(/\s+/).map(id=>doc.getElementById(id)?.textContent.trim()).filter(Boolean).join(' ');
   const label=references||el.getAttribute('aria-label')?.trim()||el.labels?.[0]?.textContent.trim()||el.getAttribute('title')?.trim()||el.getAttribute('alt')?.trim()||clippedText(el)||el.querySelector('img[alt]')?.alt||el.matches('input[type=button],input[type=submit],input[type=reset]')&&el.value;
   if(!label&&el.matches('button,input,select,textarea,[role="button"]'))add('accessControlName',el);
   if(el.matches('a[href]')&&/^(?:here|click here|more|read more|aquí|más|leer más|més|llegiu-ne més|her|les mer|les meir)[.!…]?$/iu.test(label))add('accessLinkText',el,label,true);
   keyboard.push({node:el,order:el.tabIndex,label:label||el.localName});
   if((bounds.width<24||bounds.height<24)&&(!el.matches('a')||style(el).display!=='inline'))
    add('accessTarget',el,Math.round(bounds.width)+' × '+Math.round(bounds.height)+' px',true);
   if(el.tabIndex>0)add('accessTabOrder',el,String(el.tabIndex),true);
  }
  if(el!==doc.body&&(bounds.right>width+1||bounds.left< -1)){
   const viewport=doc.documentElement.getBoundingClientRect(),parent=el.parentElement?.getBoundingClientRect();
   if(viewport.width&&parent&&parent.right<=width+1&&parent.left>=-1&&doc.documentElement.scrollWidth>width+1)
    add('accessOverflow',el,Math.ceil(bounds.width)+' px');
  }
  let hasText=false;for(let child=el.firstChild;child;child=child.nextSibling)if(child.nodeType===3&&child.data.trim()){hasText=true;break;}
  if(!hasText||el.closest(':disabled'))continue;
  const s=style(el),ink=color(s.color),paper=background(el);
  if(!paper||!ink||s.textShadow!=='none'||s.webkitTextFillColor&&s.webkitTextFillColor!==s.color){
   add('accessPaint',el,clippedText(el),true);continue;
  }
  const values=[luminance(paper),luminance(over(ink,paper))].sort((a,b)=>a-b);
  const ratio=(values[1]+.05)/(values[0]+.05),px=parseFloat(s.fontSize),threshold=px>=24||px>=56/3&&Number(s.fontWeight)>=700?3:4.5;
  if(ratio<threshold)add('accessContrast',el,ratio.toFixed(2)+' ∶ 1 ('+threshold+' ∶ 1) · '+clippedText(el));
 }
 if(mains.length!==1)add('accessMain',mains.length>1?mains[1]:doc.body,String(mains.length),mains.length===0);
 if(headings.length!==1)add('accessMainHeading',headings.length>1?headings[1]:doc.body,String(headings.length),true);
 keyboard.sort((a,b)=>(a.order||Infinity)-(b.order||Infinity));
 if(keyboard.length)add('accessFocus',keyboard[0].node,'',true);
 if(doc.querySelector('dialog:not([open]),[role="dialog"][hidden]'))add('accessDialog',doc.querySelector('dialog:not([open]),[role="dialog"][hidden]'),'',true);
 add('accessMotion',doc.body,'',true);
 return {issues,keyboard,width};
}
