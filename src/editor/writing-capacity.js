import {RICH_TEXT_LIMITS} from '../web/rich-text-model.js';
import {splitWritingSections} from '../web/rich-text-sections.js';

export function writingCapacity({toolbar,message,maxCharacters,recovery,signal,restoreFocus}){
 const dom=toolbar.ownerDocument;
 const limitKeys={characters:'capacityCharacters',nodes:'capacityNodes',depth:'capacityDepth',tableRows:'capacityRows',tableColumns:'capacityColumns',tableCell:'capacityCell',tableHeader:'capacityHeader',structure:'capacityInvalid'};
 const limits={...RICH_TEXT_LIMITS,characters:maxCharacters};
 const status=dom.createElement('p'),panel=dom.createElement('section');
 status.className='muted';status.dataset.writingCapacity='';status.hidden=true;panel.hidden=true;panel.dataset.pasteReview='';
 toolbar.after(status,panel);
 let proposal=null,busy=false;
 function near(usage){
  return Object.entries(limits).filter(([dimension,limit])=>usage[dimension]>=limit*0.9);
 }
 function describe(usage,dimensions=near(usage)){
  return dimensions.map(([dimension,limit])=>message(limitKeys[dimension],{limit,remaining:Math.max(0,limit-usage[dimension])})).join(' ');
 }
 function update(usage){
  const text=describe(usage);if(status.textContent!==text)status.textContent=text;
  status.hidden=!text;
 }
 function reason(issue,accepted){
  if(Object.hasOwn(limits,issue.dimension))return describe(accepted,[[issue.dimension,issue.limit]]);
  return message(limitKeys[issue.dimension],{limit:issue.limit});
 }
 function clear(){
  proposal=null;panel.replaceChildren();panel.hidden=true;if(!signal.aborted)restoreFocus();
 }
 function offer({notice,clipboard,apply}){
  if(proposal)return;
  proposal={clipboard,apply};
  const intro=dom.createElement('p'),feedback=dom.createElement('p'),actions=dom.createElement('div');
  intro.textContent=notice;intro.id='paste-review-'+crypto.randomUUID();intro.tabIndex=-1;
  panel.setAttribute('aria-labelledby',intro.id);
  feedback.setAttribute('role','status');actions.className='inline-actions';
  panel.hidden=false;panel.replaceChildren(intro,actions,feedback);
  function button(key,action){
   const b=dom.createElement('button');b.type='button';b.className='button';b.textContent=message(key);actions.append(b);
   b.addEventListener('click',async()=>{
    if(busy)return;
    busy=true;
    try{const task=action();if(task){actions.inert=true;await task;}}catch(error){if(!signal.aborted)feedback.textContent=error.message||message('capacityRetry');}
    finally{busy=false;actions.inert=false;}
   });
   return b;
  }
  if(apply)button('capacityInsert',()=>{if(!apply())throw Error(message('capacityChanged'));clear();});
  let file;
  const original=()=>file??=new Blob([clipboard.html||clipboard.text],{type:'text/plain;charset=utf-8'});
  const name=clipboard.html?'clipboard.html.txt':'clipboard.txt';
  if(recovery?.retain)button('capacityRetain',async()=>{
   await recovery.retain(original(),name,signal);
   clear();if(!signal.aborted){status.hidden=false;status.textContent=message('capacityRetained');}
  });
  if(!recovery?.retain)button('capacityDownload',()=>{
   const url=URL.createObjectURL(original()),a=dom.createElement('a');a.href=url;a.download=name;
   a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  if(clipboard.blocks&&recovery?.split){
   const prepare=button('capacitySplit',()=>{
    const docs=splitWritingSections(clipboard.blocks(),maxCharacters);
    if(!docs){feedback.textContent=message('capacityIndivisible');return;}
    const label=dom.createElement('label'),input=dom.createElement('input');
    label.textContent=message('capacitySectionName');input.type='text';input.maxLength=140;input.required=true;
    label.append(input);actions.insertBefore(label,prepare);prepare.remove();input.focus();
    let sections=null;
    button('capacitySaveParts',async()=>{
     if(!input.value.trim()){input.reportValidity();return;}
     sections??=docs.map((body,i)=>({id:crypto.randomUUID(),title:input.value.trim()+' '+(i+1),body}));
     input.readOnly=true;
     await recovery.split(sections,signal);clear();
     if(!signal.aborted){status.hidden=false;status.textContent=message('capacityPartsSaved',{count:sections.length});}
    });
    feedback.textContent=message('capacityParts',{count:docs.length});
   });
  }
  button('capacityDismiss',clear);
  intro.focus();
 }
 signal.addEventListener('abort',()=>{clear();status.remove();panel.remove();},{once:true});
 return {near,update,reason,offer,get pending(){return Boolean(proposal);},focus(){if(proposal)panel.firstElementChild?.focus();return Boolean(proposal);}};
}
