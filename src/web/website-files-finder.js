import {foldLayerText} from './website-layer-model.js';

const cap=8;
const tools=new Set(['visual','html','css','pages','new-page','menu','preview','check-page','galleries','media','folder','destination','save','download','picker-open','component-open']);

export function finderGroups({site,root,rows,t,openPage,selectLayer}){
 const groups=[];
 const commands=[...root.querySelectorAll('button[data-action^="website-files-"]')].filter(node=>
  tools.has(node.dataset.action.slice(14))&&!node.matches(':disabled,[hidden]')&&!node.closest('[hidden]'));
 groups.push({title:t('finderTools'),items:commands.map(node=>({name:node.textContent.trim(),run:()=>node.click()}))});
 const blockSelect=root.querySelector('select[data-website-file-block]'),add=root.querySelector('[data-action="website-files-add-block"]');
 if(blockSelect&&add&&!add.disabled)groups.push({title:t('finderElements'),items:[...blockSelect.options].map(option=>({
  name:option.textContent.trim(),run:()=>{blockSelect.value=option.value;add.click();}
 }))});
 groups.push({title:t('finderPages'),items:function*(){
  for(const page of site.pages)yield {name:page.draft?t('draftPage',{title:page.title||page.path}):page.title||page.path,detail:page.path,run:()=>openPage(page.path)};
 }});
 groups.push({title:t('finderLayers'),items:function*(){
  for(const row of rows)yield {name:row.label,detail:row.node.localName+' · '+row.path,run:()=>selectLayer(row.path)};
 }});
 return groups;
}

/** Group result limits apply before mounting controls, also for very large sites. */
export function openWebsiteFinder({doc,title,groups,t,valid,onClose}){
 const make=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const dialog=make('dialog'),heading=make('h2',title),input=make('input'),list=make('div'),close=make('button',t('finderClose'));
 dialog.className='website-finder';heading.id='website-finder-title';dialog.setAttribute('aria-labelledby',heading.id);
 input.type='search';input.placeholder=t('finderSearch');input.setAttribute('aria-label',t('finderSearch'));input.setAttribute('role','combobox');
 list.id='website-finder-results';list.setAttribute('role','listbox');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','true');
 close.type='button';close.className='button';const origin=doc.activeElement;
 dialog.append(heading,input,list,close);doc.body.append(dialog);
 let results=[],active=0,closed=false;
 function dismiss(restore=true){
  if(closed)return;closed=true;dialog.close();dialog.remove();if(restore&&origin?.isConnected)origin.focus({preventScroll:true});onClose();
 }
 function highlight(next){
  const length=results.length;if(!length){input.removeAttribute('aria-activedescendant');return;}
  active=(next+length)%length;
  for(const [i,entry] of results.entries())entry.option.setAttribute('aria-selected',String(i===active));
  input.setAttribute('aria-activedescendant',results[active].option.id);results[active].option.scrollIntoView({block:'nearest'});
 }
 function choose(index){
  const entry=results[index];if(!entry)return;
  const allowed=valid();dismiss();if(allowed)entry.item.run();
 }
 function paint(){
  if(!valid()){dismiss(false);return;}
  list.replaceChildren();results=[];const tokens=foldLayerText(input.value.trim()).split(/\s+/u).filter(Boolean);
  for(const group of groups){
   const section=make('div');section.setAttribute('role','group');section.setAttribute('aria-label',group.title);
   let count=0;
   for(const item of typeof group.items==='function'?group.items():group.items){
    const text=foldLayerText(item.name+' '+(item.detail??'')+' '+group.title);
    if(!tokens.every(term=>text.includes(term))||(item.allowed&&!item.allowed()))continue;
    if(!count)section.append(make('h3',group.title));
    const option=make('div'),i=results.length;
    option.setAttribute('role','option');option.id='website-finder-result-'+i;option.append(make('span',item.name));
    if(item.detail)option.append(make('small',item.detail));
    option.addEventListener('mousedown',e=>e.preventDefault());option.addEventListener('click',()=>choose(i));
    results.push({option,item});section.append(option);if(++count===cap)break;
   }
   if(count)list.append(section);
  }
  if(!results.length)list.append(make('p',t('finderEmpty')));
  highlight(0);
 }
 close.onclick=()=>dismiss();dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});input.addEventListener('input',paint);
 input.addEventListener('keydown',event=>{
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();highlight(active+(event.key==='ArrowDown'?1:-1));}
  else if(event.key==='Enter'){event.preventDefault();choose(active);}
 });
 dialog.showModal();input.focus();paint();
 return ()=>dismiss(false);
}
