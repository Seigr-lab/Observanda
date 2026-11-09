import {inventoryWindow} from './website-inventory.js';
import {savedFileReference} from './website-files-navigation.js';
import {targetHref} from './website-reference-targets.js';

export function referencePicker(form,{model,path,directory,href,t,signal,checkPin,choose,onError}){
 const outer=form.ownerDocument;
 function el(parent,tag,text){
  const node=outer.createElement(tag);if(text!==undefined)node.textContent=text;parent.append(node);return node;
 }
 function action(parent,key,run){
  const node=el(parent,'button',t(key));node.className='button';node.type='button';node.onclick=run;return node;
 }
 const panel=el(form,'details');el(panel,'summary',t('referenceChoose'));
 const body=el(panel,'div');
 let sequence=0,loaded=false,activePath='',selectedId='',use,chooser,pageChooser;
 const permittedPages=model.pages;
 function windowControl(label,filterKey,items,labelFor,onSelect){
  const group=el(body,'div'),filter=el(el(group,'label',t(filterKey)),'input');filter.type='search';
  const select=el(el(group,'label',t(label)),'select');select.size=4;
  const nav=el(group,'div');nav.className='inline-actions';
  const previous=action(nav,'prevPage',()=>draw(window.previous)),count=el(nav,'span'),next=action(nav,'nextPage',()=>draw(window.next));
  let window;
  function draw(offset=0,prefer){
   window=inventoryWindow(items(),{offset,limit:12,query:filter.value,label:labelFor});
   select.replaceChildren();
   for(const item of window.items)select.add(new Option(labelFor(item),item.path??item.id));
   select.selectedIndex=window.items.length?0:-1;
   if(prefer&&window.items.some(x=>(x.path??x.id)===prefer))select.value=prefer;
   count.textContent=window.total?t('websiteReviewRange',{first:window.offset+1,last:window.offset+window.items.length,total:window.total}):t('referenceNoMatches');
   previous.hidden=next.hidden=window.previous===null&&window.next===null;
   previous.disabled=window.previous===null;next.disabled=window.next===null;
   onSelect(select.value);
  }
  filter.oninput=()=>draw();select.onchange=()=>onSelect(select.value);
  filter.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();select.focus();}};
  return {draw};
 }
 let rows=[];
 async function selectPage(next){
  if(next===activePath)return;
  activePath=next;rows=[];chooser.draw();
  const version=++sequence;if(!next)return;
  try{
   const result=await model.targets(next);
   if(version!==sequence||signal.aborted||!panel.open||!panel.isConnected)return;
   rows=result;chooser.draw();
  }catch(error){if(!signal.aborted&&version===sequence)onError(error);}
 }
 panel.ontoggle=async()=>{
  if(!panel.open){++sequence;activePath='';rows=[];body.replaceChildren();loaded=false;return;}
  if(loaded)return;
  const version=++sequence;loaded=true;
  try{
   await checkPin();if(version!==sequence||signal.aborted||!panel.open||!panel.isConnected)return;
   pageChooser=windowControl('page','pageSearch',()=>permittedPages.values(),row=>row.title+' · '+row.path,p=>void selectPage(p));
   chooser=windowControl('scienceTarget','scienceSearch',()=>rows,row=>t(row.kind)+' · '+(row.label?row.label+' · ':'')+row.id,id=>{selectedId=id;use.disabled=!id;});
   use=action(body,'referenceUse',()=>{
    if(activePath&&selectedId){choose(targetHref(path,activePath,selectedId));panel.open=false;}
   });use.disabled=true;
   const known=savedFileReference(href,new URL(path,directory),directory)?.path;
   const preferred=permittedPages.has(known)?known:path;
   let index=0;for(const key of permittedPages.keys()){if(key===preferred)break;index++;}
   pageChooser.draw(Math.floor(index/12)*12,preferred);
  }catch(error){if(!signal.aborted&&version===sequence)onError(error);}
 };
}
