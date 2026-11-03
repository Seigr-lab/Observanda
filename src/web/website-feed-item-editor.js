const fields=['title','date','type','tags','content'];
const label={title:'feedFieldTitle',date:'pickerDate',type:'pickerType',tags:'pickerTags',content:'feedFieldContent'};
const tag={title:'h3',date:'p',type:'p',tags:'p',content:'div'};
const orderedHTML=keys=>'<article>\n'+keys.map(key=>'  <'+tag[key]+' data-feed-field="'+key+'"></'+tag[key]+'>').join('\n')+'\n</article>';

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
 let keys=[],active=new Set();
 function paint(focus){
  order.replaceChildren();
  keys.forEach((key,i)=>{
   const row=make('li',order),field=make('label',row),check=make('input',field);
   check.type='checkbox';check.checked=active.has(key);check.dataset.feedField=key;make('span',field,t(label[key]));
   check.onchange=()=>{if(check.checked)active.add(key);else active.delete(key);build.disabled=!active.size;};
   for(const step of [-1,1]){
    const button=make('button',row,t(step<0?'up':'down'));button.type='button';button.className='button subtle';button.disabled=!keys[i+step];
    button.setAttribute('aria-label',t(step<0?'up':'down')+' · '+t(label[key]));
    button.onclick=()=>{[keys[i],keys[i+step]]=[keys[i+step],keys[i]];paint(key);};
   }
  });
  build.disabled=!active.size;if(focus)order.querySelector('[data-feed-field="'+focus+'"]').focus();
 }
 function readOrder(){
  const template=document.createElement('template');template.innerHTML=input.value;
  const found=[...new Set([...template.content.querySelectorAll('[data-feed-field]')].map(n=>n.dataset.feedField).filter(k=>fields.includes(k)))];
  active=new Set(found);keys=[...found,...fields.filter(k=>!active.has(k))];paint();
 }
 build.onclick=()=>{input.value=orderedHTML(keys.filter(key=>active.has(key)));changed();};
 input.oninput=changed;input.onchange=readOrder;
 return {set(value){input.value=value??orderedHTML(['title','content']);readOrder();},get:()=>input.value};
}
