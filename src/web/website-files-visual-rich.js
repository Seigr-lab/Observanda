import {selectionMarkStates,setSelectionMark} from './website-files-rich-marks.js';
import {websiteTextLinks} from './website-files-text-link.js';
import {scientificClipboard,insertClipboardMarkup} from './website-files-clipboard.js';

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
  // One compact row: each command shows a short sample of what it does; its name is the
  // button's accessible name and tooltip.
  const svg=paths=>'<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg>';
  const icons={clearFormatting:svg('<path d="M5 6h11M10 6l-3 13M14 14l6 6M20 14l-6 6"/>'),insertUnorderedList:svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>'),insertOrderedList:svg('<path d="M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M3.5 9h3M3.5 14.5a1.5 1.5 0 0 1 3 .3c0 1-3 2.2-3 3.7h3"/>')};
  for(const [name,key] of commands){
    const b=button(key,()=>command(name));b.dataset.visualCommand=name;controls.set(name,b);
    b.classList.add('website-rich-tool');b.setAttribute('aria-label',t(key));b.title=t(key);
    const sample={bold:['strong','B'],italic:['em','I'],underline:['u','U'],strikeThrough:['s','S'],highlight:['mark','ab'],inlineCode:['code','</>']}[name];
    if(sample)b.replaceChildren(make(sample[0],sample[1]));
    else if(name==='subscript'||name==='superscript'){const example=make('span');example.append('x',make(name==='subscript'?'sub':'sup','2'));b.replaceChildren(example);}
    else if(icons[name])b.innerHTML=icons[name];
    if(['bold','italic','underline'].includes(name)){
      const letter={bold:'B',italic:'I',underline:'U'}[name];
      b.setAttribute('aria-keyshortcuts','Control+'+letter+' Meta+'+letter);
      b.title=t(key)+' (Ctrl+'+letter+')';
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
    const markup=scientificClipboard(document,event.clipboardData?.getData('text/html'));
    const text=event.clipboardData?.getData('text/plain');
    if(markup||text){beforeChange();if(markup)insertClipboardMarkup(document,markup,selection);else document.execCommand('insertText',false,text);change();}
  });
  sync();
  return {toolbar};
}
