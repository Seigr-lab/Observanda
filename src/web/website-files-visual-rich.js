import {selectionMarkStates,setSelectionMark} from './website-files-rich-marks.js';
import {websiteTextLinks} from './website-files-text-link.js';

const blockSelector='p,h1,h2,h3,h4,h5,h6,li,blockquote,div,figcaption,td,th,summary,pre';
const owned='[data-observanda-part],[data-observanda-source],[data-observanda-link]';
const element=node=>node?.nodeType===1?node:node?.parentElement;


export function websiteRichText({document,host,t,listen,make,beforeChange,change,safeRange}) {
  const toolbar=make('fieldset');toolbar.className='website-visual-rich';
  toolbar.append(make('legend',t('richText')));
  const context=make('p');context.className='website-rich-context';context.id='website-rich-context';
  context.setAttribute('role','status');toolbar.setAttribute('aria-describedby',context.id);toolbar.append(context);
  const tools=make('div');tools.className='website-visual-actions';toolbar.append(tools);
  const win=document.defaultView, controls=new Map();
  let saved=null;
  function capture(){
    const selection=win.getSelection();
    if(!selection.rangeCount)return;
    const range=selection.getRangeAt(0);
    saved=safeRange(range)&&document.body.contains(range.commonAncestorContainer)?range.cloneRange():null;
    sync();
  }
  function current(){return saved && saved.startContainer.isConnected && saved.endContainer.isConnected && safeRange(saved)?saved:null;}
  function safeBlock(range){
    const first=element(range.startContainer)?.closest(blockSelector),last=element(range.endContainer)?.closest(blockSelector);
    // Native block commands may replace entire elements. Their scope must not
    // consume a placement or alter the tag/identity of a converted section.
    return first&&last&&!first.matches(owned)&&!last.matches(owned)&&!first.querySelector(owned)&&!last.querySelector(owned);
  }
  function restore(){
    const range=current();if(!range)return null;
    element(range.startContainer).closest('[contenteditable="true"]')?.focus({preventScroll:true});
    const selection=win.getSelection();selection.removeAllRanges();selection.addRange(range);
    return range;
  }
  const commands=[
    ['bold','richBold'],['italic','richItalic'],['underline','richUnderline'],
    ['strikeThrough','richStrike'],['subscript','richSubscript'],['superscript','richSuperscript'],
    ['highlight','richHighlight'],['inlineCode','richInlineCode'],['clearFormatting','richClear'],
    ['insertUnorderedList','richBullets'],['insertOrderedList','richNumbers']
  ];
  const structural=new Set(['insertUnorderedList','insertOrderedList','formatBlock']);
  const selectionOnly=new Set(['highlight','inlineCode','clearFormatting']);
  function command(name,value){
    const range=restore();if(!range||structural.has(name)&&!safeBlock(range))return;
    if(range.collapsed&&selectionOnly.has(name))return;
    beforeChange();
    let changed;
    if(!range.collapsed&&controls.has(name)&&!structural.has(name))changed=setSelectionMark(range,name);
    else {document.execCommand('styleWithCSS',false,false);changed=document.execCommand(name,false,value);}
    if(changed)change();
    capture();
  }
  function button(key,fn){
    const b=make('button',t(key));b.type='button';tools.append(b);listen(b,'click',fn);return b;
  }
  for(const [name,key] of commands){
    const b=button(key,()=>command(name));b.dataset.visualCommand=name;controls.set(name,b);
    const sample={bold:'strong',italic:'em',underline:'u',strikeThrough:'s',highlight:'mark',inlineCode:'code'}[name];
    if(sample)b.replaceChildren(make(sample,t(key)));
    if(name==='subscript'||name==='superscript'){
      const example=make('span');example.className='website-rich-sample';example.setAttribute('aria-hidden','true');
      if(name==='subscript')example.append('H',make('sub','2'),'O');else example.append('Fe',make('sup','3+'));
      b.prepend(example);
    }
    if(name==='insertUnorderedList'||name==='insertOrderedList'){
      const marker=make('span',name==='insertUnorderedList'?'•':'1.');marker.className='website-rich-sample';marker.setAttribute('aria-hidden','true');b.prepend(marker);
    }
    if(['bold','italic','underline'].includes(name)){
      const key={bold:'B',italic:'I',underline:'U'}[name];
      b.setAttribute('aria-keyshortcuts','Control+'+key+' Meta+'+key);
    }
  }
  const heading=make('select');heading.setAttribute('aria-label',t('richHeading'));tools.append(heading);
  const option=(value,label)=>{const o=make('option',label);o.value=value;heading.append(o);};
  option('',t('richHeading'));option('p',t('richParagraph'));
  for(let i=1;i<=6;i++)option('h'+i,t('richHeading')+' '+i);
  listen(heading,'change',()=>{if(heading.value)command('formatBlock',heading.value);});

  websiteTextLinks({document,tools,t,listen,safeRange,beforeChange,change});
  function sync(){
    const range=current(),marks=selectionMarkStates(range);
    for(const [name,button] of controls){
      button.disabled=!range||structural.has(name)&&!safeBlock(range)||range.collapsed&&selectionOnly.has(name);
      if(name==='clearFormatting')continue;
      const native=range&&(structural.has(name)||range.collapsed&&!selectionOnly.has(name));
      const pressed=native?(document.queryCommandIndeterm(name)?'mixed':String(document.queryCommandState(name))):marks.get(name)??'false';
      button.setAttribute('aria-pressed',pressed);
    }
    tools.hidden=!range;
    const label=t(!range?'richChooseText':range.collapsed?'richCaret':'richSelection');if(context.textContent!==label)context.textContent=label;
    heading.disabled=!range||!safeBlock(range);heading.value=range?element(range.startContainer).closest(blockSelector)?.localName??'':'';
  }
  listen(document,'selectionchange',()=>{
    // Moving focus to an external control may empty the native selection.
    // Keep the last live range while that control is operating on it.
    if(host.activeElement?.contentDocument===document)capture();
  });
  listen(document,'keydown',event=>{
    if(event.defaultPrevented||event.isComposing||event.shiftKey||event.altKey||!(event.ctrlKey||event.metaKey))return;
    const name=({b:'bold',i:'italic',u:'underline'})[event.key.toLowerCase()];
    if(!name)return;
    capture();const range=current();if(!range||range.collapsed)return;
    event.preventDefault();command(name);
  });
  // selectionchange is queued. A keyboard move to the inspector or a pointer
  // activation can leave the frame before that event runs; capture the live
  // native selection while the editing host still owns its focus.
  listen(document,'keyup',capture);
  listen(document,'pointerup',capture);
  listen(document,'focusout',capture,{capture:true});
  listen(document.body,'paste',event=>{
    event.preventDefault();
    const selection=win.getSelection();if(!selection.rangeCount||!safeRange(selection.getRangeAt(0)))return;
    const text=event.clipboardData?.getData('text/plain');
    if(text){beforeChange();document.execCommand('insertText',false,text);change();}
  });
  sync();
  return {toolbar};
}
