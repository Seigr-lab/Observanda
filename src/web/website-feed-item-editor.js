import {feedFields} from './website-feed-fields.js';
const fields=Object.keys(feedFields);
const orderedHTML=keys=>'<article>\n'+keys.map(key=>'  <'+feedFields[key].tag+' data-feed-field="'+key+'"></'+feedFields[key].tag+'>').join('\n')+'\n</article>';

// The arrangement is an explicit way to replace an item template. Opening a
// saved design never parses and serializes its authored markup back to storage.
export function feedItemEditor(parent,{t,changed}){
 const make=(tag,holder,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;holder.append(el);return el;};
 const layout=make('details',parent);make('summary',layout,t('feedArrange'));
 const order=make('ol',layout);order.className='website-feed-fields';
 const build=make('button',layout,t('feedUseFields'));build.type='button';build.className='button';
 make('p',layout,t('feedArrangeHelp')).className='muted';
 const raw=make('details',parent);make('summary',raw,t('feedItemHTML'));
 const rawLabel=make('label',raw,t('feedItemHTML')),input=make('textarea',rawLabel);input.dataset.feedItemHtml='';input.rows=7;input.spellcheck=false;
 make('p',raw,t('feedBindingHelp')).className='muted';
 let keys=[],active=new Set(),generated=false,pending=false,dragged=null;
 const selected=()=>keys.filter(key=>active.has(key));
 function apply(){input.value=orderedHTML(selected());generated=true;pending=false;build.disabled=true;changed();}
 function arrange(focus){
  if(generated)apply();else{pending=true;changed();}
  paint(focus);
 }
 function move(key,target){
  const from=keys.indexOf(key),to=keys.indexOf(target);
  if(from<0||to<0||from===to)return;
  keys.splice(from,1);keys.splice(to,0,key);arrange(key);
 }
 function paint(focus){
  order.replaceChildren();
  const enabled=selected();
  [...enabled,...keys.filter(key=>!active.has(key))].forEach(key=>{
   const row=make('li',order),i=enabled.indexOf(key),field=make('label',row),check=make('input',field);
   check.type='checkbox';check.checked=active.has(key);check.dataset.feedField=key;make('span',field,t(feedFields[key].label));
   check.onchange=()=>{if(check.checked)active.add(key);else active.delete(key);arrange(key);};
   if(i<0)return;
   const grip=make('span',row,'⠿');grip.className='website-feed-grip';grip.draggable=true;grip.setAttribute('aria-hidden','true');
   grip.ondragstart=e=>{dragged=key;e.dataTransfer.setData('text/plain',t(feedFields[key].label));e.dataTransfer.effectAllowed='move';};
   row.ondragover=e=>{if(dragged&&dragged!==key){e.preventDefault();e.dataTransfer.dropEffect='move';row.dataset.drop='';}};
   row.ondragleave=()=>{delete row.dataset.drop;};grip.ondragend=()=>{dragged=null;for(const el of order.children)delete el.dataset.drop;};
   row.ondrop=e=>{if(dragged){e.preventDefault();const keyToMove=dragged;dragged=null;move(keyToMove,key);}};
   for(const step of [-1,1]){
    const button=make('button',row,step<0?'↑':'↓');button.type='button';button.disabled=!enabled[i+step];
    button.title=t(step<0?'up':'down')+' · '+t(feedFields[key].label);button.setAttribute('aria-label',button.title);
    button.onclick=()=>move(key,enabled[i+step]);
   }
  });
  build.hidden=generated;build.disabled=!active.size||!pending;if(focus)order.querySelector('[data-feed-field="'+focus+'"]').focus({preventScroll:true});
 }
 function readOrder(){
  const template=document.createElement('template');template.innerHTML=input.value;
  const found=[...new Set([...template.content.querySelectorAll('[data-feed-field]')].map(n=>n.dataset.feedField).filter(k=>fields.includes(k)))];
  active=new Set(found);keys=[...found,...fields.filter(k=>!active.has(k))];generated=input.value===orderedHTML(found);pending=false;paint();
 }
 build.onclick=()=>{apply();paint();};
 input.oninput=changed;input.onchange=readOrder;
 return {set(value,draft=null){
  input.value=value??orderedHTML(['title','content']);readOrder();
  if(draft){active=new Set(draft);keys=[...draft,...fields.filter(k=>!active.has(k))];pending=true;paint();}
 },get:()=>input.value,draft:()=>pending?selected():null,forSave(){
  if(pending||!active.size){layout.open=true;(active.size?build:order.querySelector('input'))?.focus();throw Error(t('feedFinishFields'));}
  return input.value;
 }};
}
