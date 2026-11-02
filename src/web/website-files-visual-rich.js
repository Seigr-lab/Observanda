const blockSelector='p,h1,h2,h3,h4,h5,h6,li,blockquote,div,figcaption,td,th,summary,pre';
const owned='[data-observanda-part],[data-observanda-source],[data-observanda-link]';
const element=node=>node?.nodeType===1?node:node?.parentElement;

function validAddress(value, base) {
  if(!value || /[\\\s\u0000-\u001f]/.test(value))return false;
  if(value.startsWith('#'))return true;
  let url;
  try{url=new URL(value,base);}catch{return false;}
  if(/^[a-z][a-z\d+.-]*:/i.test(value)){
    if(url.protocol==='mailto:')return true;
    return ['http:','https:'].includes(url.protocol) && !url.username && !url.password &&
      !/^(?:localhost|127\.|\[::1\])/.test(url.hostname) && !/^\/api(?:\/|$)/i.test(url.pathname);
  }
  if(value.startsWith('/')||/[?%:]/.test(value))return false;
  const root=new URL('./',base);
  const revision=root.pathname.match(/^.*\/preview\/[^/]+\/[a-f0-9]{64}\//);
  return url.origin===root.origin&&url.pathname.startsWith(revision?.[0]??root.pathname);
}

export function websiteRichText({document,host,t,listen,make,beforeChange,change,safeRange}) {
  const toolbar=make('fieldset');toolbar.className='website-visual-rich';
  toolbar.append(make('legend',t('richText')));
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
    ['insertUnorderedList','richBullets'],['insertOrderedList','richNumbers']
  ];
  const structural=new Set(['insertUnorderedList','insertOrderedList','formatBlock']);
  function command(name,value){
    const range=restore();if(!range||structural.has(name)&&!safeBlock(range))return;
    beforeChange();
    document.execCommand('styleWithCSS',false,false);
    const changed=document.execCommand(name,false,value);
    if(changed)change();
    capture();
  }
  function button(key,fn){
    const b=make('button',t(key));b.type='button';tools.append(b);listen(b,'click',fn);return b;
  }
  for(const [name,key] of commands){
    const b=button(key,()=>command(name));b.dataset.visualCommand=name;controls.set(name,b);
  }
  const heading=make('select');heading.setAttribute('aria-label',t('richHeading'));tools.append(heading);
  const option=(value,label)=>{const o=make('option',label);o.value=value;heading.append(o);};
  option('',t('richHeading'));option('p',t('richParagraph'));
  for(let i=1;i<=6;i++)option('h'+i,t('richHeading')+' '+i);
  listen(heading,'change',()=>{if(heading.value)command('formatBlock',heading.value);});

  const linkBox=make('div');linkBox.className='website-visual-link';linkBox.hidden=true;
  const input=make('input');input.type='text';input.setAttribute('aria-label',t('richLinkAddress'));
  const apply=make('button',t('richApplyLink'));apply.type='button';linkBox.append(input,apply);toolbar.append(linkBox);
  function anchor(range){
    const first=element(range?.startContainer)?.closest('a');
    return first?.contains(range.endContainer)&&!first.matches('[data-observanda-link]')?first:null;
  }
  const link=button('richLink',()=>{
    const range=current();if(!range)return;
    linkBox.hidden=!linkBox.hidden;
    if(!linkBox.hidden){input.setCustomValidity('');input.value=anchor(range)?.getAttribute('href')??'';input.focus();}
  });
  function applyLink(){
    const range=current(), value=input.value.trim();if(!range)return;
    if(!validAddress(value,document.location.href)){input.setCustomValidity(t('richLinkAddress'));input.reportValidity();return;}
    const node=anchor(range);linkBox.hidden=true;
    if(node){beforeChange();node.setAttribute('href',value);restore();change();return;}
    if(!range.collapsed){command('createLink',value);return;}
    restore();beforeChange();
    const a=document.createElement('a');a.href=value;a.textContent=value;
    range.insertNode(a);range.setStartAfter(a);range.collapse(true);change();
  }
  listen(input,'input',()=>input.setCustomValidity(''));
  listen(input,'keydown',event=>{if(event.key==='Enter'){event.preventDefault();applyLink();}else if(event.key==='Escape'){event.preventDefault();linkBox.hidden=true;link.focus();}});
  listen(apply,'click',applyLink);
  const unlink=button('richUnlink',()=>{
    const range=current(),node=range&&anchor(range);
    if(!node)return;beforeChange();restore();node.replaceWith(...node.childNodes);change();capture();
  });
  function sync(){
    const range=current();
    for(const [name,button] of controls){
      button.disabled=!range||structural.has(name)&&!safeBlock(range);
      button.setAttribute('aria-pressed',String(!!range&&document.queryCommandState(name)));
    }
    heading.disabled=!range||!safeBlock(range);heading.value=range?element(range.startContainer).closest(blockSelector)?.localName??'':'';
    link.disabled=!range;unlink.disabled=!range||!anchor(range);
  }
  listen(document,'selectionchange',()=>{
    // Moving focus to an external control may empty the native selection.
    // Keep the last live range while that control is operating on it.
    if(host.activeElement?.contentDocument===document)capture();
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
