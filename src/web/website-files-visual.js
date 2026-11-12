import {applyVisualStyle, readVisualStyle, visualClass, visualStyleFields, writeVisualStyle, backgroundPictureValue} from './website-files-visual-style.js';
import {websiteRichText} from './website-files-visual-rich.js';
import {websiteTableTools} from './website-files-table.js';
import {responsiveLayout} from './website-files-responsive.js';
import {pinStyleText,websiteTextRuns} from './website-text-style.js';
import {websiteScientificReferences} from './website-files-science.js';

const chrome = '[data-observanda-editor]';
const source = '[data-observanda-source]';
const part = '[data-observanda-part]';
const linked = '[data-observanda-link]';
const editable = 'h1,h2,h3,h4,h5,h6,p,li,figcaption,blockquote,summary,dt,dd,td,th,pre';
const blocks = 'section,article,header,footer,aside,nav,figure,table,[data-section-id],[data-region-kind],[data-website-annotation],'+part+
  ',:is(body,main) > :is(h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,table,hr,img,video,audio,details,pre),:is(body,main) > div:not(.page-composition,.container-content)';
const protectedNodes = source+','+part+','+linked+',[data-website-feed]';
const interactiveSelector='button,input,select,textarea,a[href]';
const outlineContents='h1,h2,h3,h4,h5,h6,p,ul,ol,li,dl,dt,dd,blockquote,details,summary,figcaption,pre,hr,img,video,audio,.website-columns>div,[data-website-instance],'+interactiveSelector;

/** Paths are relative to body and use element-child indices in the saved HTML. */
export function websiteVisualSections(document,{includeContents=false}={}) {
  const entries = [], stack = [];
  function children(parent, prefix, depth) {
    for (let i=parent.children.length-1; i>=0; --i) stack.push({node:parent.children[i], path:prefix+i, depth});
  }
  children(document.body, '', 0);
  while (stack.length) {
    const row = stack.pop();
    if (row.node.matches(chrome+',script,style,template,svg,[hidden]')) continue;
    const section = row.node.matches(blocks)||(includeContents&&row.node.matches(outlineContents));
    if (section) entries.push(row);
    if(!row.node.hasAttribute('data-website-feed'))children(row.node, row.path+'/', row.depth+(section ? 1 : 0));
  }
  return entries;
}

function pathOf(node, body) {
  const path = [];
  while (node && node!==body) {
    path.push(Array.prototype.indexOf.call(node.parentElement.children, node));
    node = node.parentElement;
  }
  return path.reverse().join('/');
}
function element(node) { return node?.nodeType===1 ? node : node?.parentElement; }
function writable(node) {
  if (!node || node.closest(chrome+','+linked) || !node.isContentEditable) return false;
  const owner=node.closest(source);
  return !owner || node.closest(part)?.closest(source)===owner;
}
function safeRange(range, body) {
  const first=element(range.startContainer), last=element(range.endContainer);
  if (!writable(first) || !writable(last) || first.closest(part)!==last.closest(part)) return false;
  if (range.collapsed || range.commonAncestorContainer.nodeType===3) return true;
  for (const node of range.commonAncestorContainer.querySelectorAll(protectedNodes+','+chrome)) {
    if (range.intersectsNode(node) && !(node.contains(first) && node.contains(last))) return false;
  }
  return body.contains(first) && body.contains(last);
}
function colour(value) {
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*1)?\)$/.exec(value);
  return rgb ? '#'+rgb.slice(1).map(n=>Number(n).toString(16).padStart(2,'0')).join('') : '';
}
function editableText(node, document) {
  if (!node) return null;
  const walker=document.createTreeWalker(node, 4);
  for (let text=walker.nextNode(); text; text=walker.nextNode()) {
    if (text.data.trim() && writable(text.parentElement)) return text;
  }
  return null;
}
function styleRange(range, body) {
  if (!range || range.collapsed || !safeRange(range, body)) return false;
  const first=element(range.startContainer), last=element(range.endContainer);
  return first.closest(editable)===last.closest(editable) && first.closest(blocks)===last.closest(blocks);
}

/** All editor decorations are outside the saved tree or marked for removal by
 * websiteCanvasValue. Selection and pointer events are delegated once per frame. */
export function bindWebsiteVisual({document, inspector, t, beforeChange, change, getCSS, setCSS, onSelect, stylesheet, getViewport,getWidth,previewWidth,getRanges,manageRanges,layerDrag,menuTarget,openMenu,component=false,pictures=[],stylesheetPath='style.css',uploadPicture=null}) {
  const win=document.defaultView, body=document.body, host=inspector.ownerDocument;
  const controller=new AbortController(), signal=controller.signal;
  const listen=(node,type,fn,opts={})=>node.addEventListener(type,fn,{...opts,signal});
  const make=(tag, text)=>{const el=host.createElement(tag); if(text!==undefined)el.textContent=text; return el;};
  const temporary=tag=>{const el=document.createElement(tag); el.dataset.observandaEditor=''; return el;};
  const sheet=temporary('style');
  // Keep the outer composition visible. The pointer and keyboard overlay
  // outlines the precise nested part being edited.
  sheet.textContent=':where('+blocks+'):not(:where([data-observanda-source] *,[data-website-instance] *,[data-website-region] *)){outline:1px dashed #4968a699;outline-offset:-1px}';
  document.head.append(sheet);
  const savedStyle=document.head.querySelector('style[data-observanda-editor]');
  const frame=temporary('div');
  frame.contentEditable='false';
  frame.style.cssText='all:initial!important;position:fixed!important;top:0!important;left:0!important;z-index:2147483647!important;pointer-events:none!important;';
  body.append(frame);
  const shadow=frame.attachShadow({mode:'open'});
  const outline=document.createElement('div'), actions=document.createElement('div'), action=document.createElement('button'), grip=document.createElement('button');
  const overlayStyle=document.createElement('style');
  outline.className='outline';actions.className='actions';grip.className='grip';
  overlayStyle.textContent='.outline{position:fixed;box-sizing:border-box;border:2px solid #3859b2;pointer-events:none}.actions{display:flex;position:fixed;gap:2px}.actions button{pointer-events:auto;border:1px solid #25428b;border-radius:4px;background:white;color:#182e65;font:600 13px/1.4 system-ui;padding:4px 8px;white-space:nowrap;cursor:pointer}.actions .grip{cursor:grab}.actions .grip:active{cursor:grabbing}button:focus-visible{outline:3px solid #cf7600}[hidden]{display:none!important}';
  action.type='button'; action.textContent=t('sectionEdit');
  grip.type='button';grip.style.touchAction='none';grip.textContent='⠿ '+t('layerDrag');grip.hidden=true;
  overlayStyle.textContent+='.actions.moving button{pointer-events:none}';
  actions.append(grip,action);outline.hidden=actions.hidden=true;shadow.append(overlayStyle,outline,actions);

  // A linked label and its destination belong to the linked entry's privacy
  // grant. Keep both intact even inside a freely editable source paragraph.
  const links=[];
  for (const link of body.querySelectorAll(linked)) {
    if (link.hasAttribute('data-observanda-editor-editable')) continue;
    links.push(link); link.dataset.observandaEditorEditable=link.getAttribute('contenteditable')??'absent';
    link.contentEditable='false';
  }

  let selected=null, hover=null, range=null, activePath=null, timer=0;
  const observer=new win.ResizeObserver(schedule);
  const fields=visualStyleFields(document,t,{pictures,stylesheetPath}), controls=new Map(), paintLabels=new Map(), touched=new Set();
  const form=make('form'); form.className='website-visual-style';
  // Other inspector tools (such as adding an annotation) validate their
  // own inputs. An empty field in a closed tool cannot block a style edit.
  form.noValidate=true;
  const title=make('h3',t('sectionAppearance')), prompt=make('p',t('sectionSelectPrompt'));
  const scope=make('select'); scope.dataset.visualScope='';
  const labelled=(text,control)=>{const label=make('label');label.append(make('span',text),control);return label;};
  const option=(value,text)=>{const el=make('option',text);el.value=value;return el;};
  for(const [value,key] of [['section','sectionScopeSection'],['selection','sectionScopeSelection'],['page','sectionScopePage'],['site','sectionScopeSite']])scope.append(option(value,t(key)));
  if(component)for(const o of scope.options)if(['site','page'].includes(o.value))o.hidden=true;
  const grid=make('div');grid.className='website-visual-fields';
  // Pictures, overlays, spacing and effects sit in their own collapsed group,
  // so the everyday text and colour controls stay in view.
  const extra=make('details');extra.className='website-visual-extra';extra.append(make('summary',t('sectionMoreAppearance')));
  const extraGrid=make('div');extraGrid.className='website-visual-fields';extra.append(extraGrid);
  for (const field of fields) {
    let control;
    if (field.options) {
      control=make('select');control.append(option('',t('sectionInherit')));
      for (const [value,text] of field.options)control.append(option(value,text));
    } else {
      control=make('input');control.type=field.type;
      for (const attr of ['min','max','step'])if(field[attr]!==undefined)control.setAttribute(attr,field[attr]);
    }
    control.dataset.visualProperty=field.name;controls.set(field.name,control);
    const unit=field.unit?' ('+field.unit+')':'';
    const label=labelled(t(field.label)+unit,control);(field.group==='more'?extraGrid:grid).append(label);
    // A new picture can be added here; it uses the gallery's picture copies.
    if(field.name==='background-image'&&uploadPicture){
     const input=make('input'),upload=make('button',t('sectionUploadPicture'));
     input.type='file';input.accept='image/png,image/jpeg,image/webp,image/gif';input.hidden=true;input.dataset.visualPictureUpload='';
     upload.type='button';upload.className='button';upload.addEventListener('click',()=>input.click());
     listen(input,'change',async()=>{
      const file=input.files?.[0];input.value='';if(!file)return;
      upload.disabled=true;
      try{
       const name=await uploadPicture(file),value=backgroundPictureValue(name,stylesheetPath);
       if(![...control.options].some(o=>o.value===value))control.append(option(value,t('sectionPictureNumber',{number:control.options.length-1,name:name.slice(9,17)})));
       control.value=value;touched.add(field.name);apply.disabled=false;
      }finally{upload.disabled=false;upload.focus();}
     });
     label.after(upload,input);
    }
    if(field.type==='color'){
      const value=make('small');value.id='website-paint-'+field.name;value.setAttribute('aria-hidden','true');control.setAttribute('aria-describedby',value.id);
      label.append(value);paintLabels.set(field.name,value);
    }
    const touch=()=>{
      if(field.type==='color')showPaint(control,field.name,control.value);
      touched.add(field.name);apply.disabled=false;
    };
    listen(control,'input',touch);listen(control,'change',touch);
  }
  const edit=make('button',t('sectionEditText')), apply=make('button',t('sectionApply')), reset=make('button',t('sectionReset'));
  edit.type=reset.type='button';apply.type='submit';
  const styleActions=make('div');styleActions.className='website-visual-actions';styleActions.append(apply,reset);
  const rich=websiteRichText({document,host,t,listen,make,beforeChange,change,safeRange:range=>safeRange(range,body)});
  const tableHost=make('div');
  const table=websiteTableTools({document,inspector:tableHost,translate:t,beforeChange,changed:change,
   addCSS:rule=>{if(!getCSS().includes(rule))persistStyle(getCSS()+'\n'+rule,savedStyle.textContent+'\n'+rule);}});
  form.append(title,prompt,edit,rich.toolbar,tableHost,labelled(t('sectionScope'),scope),grid,...(extraGrid.children.length?[extra]:[]),styleActions);
  const responsive=responsiveLayout({document,host:form,before:rich.toolbar,t,scope,selected:()=>selected,selectNode:node=>setSelected(node,true,true),getCSS,getViewport,getWidth,previewWidth,getRanges,manageRanges,beforeChange,change,make,listen,signal,
    write:(css,transform)=>{persistStyle(css,transform(savedStyle.textContent));schedule();}});
  websiteScientificReferences({document,host:form,t,listen,beforeChange,change,selected:()=>selected});
  inspector.replaceChildren(form);

  function position() {
    timer=0;
    const node=hover??selected;
    if(!node?.isConnected){outline.hidden=actions.hidden=true;return;}
    const rect=node.getBoundingClientRect();
    const visible=rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.top<win.innerHeight&&rect.left<win.innerWidth;
    outline.hidden=actions.hidden=!visible;
    if(!visible)return;
    grip.hidden=!layerDrag?.canMove(node);
    grip.title=t('layerDragHint',{name:node.getAttribute('aria-label')||node.localName});
    action.textContent=t(openMenu&&menuTarget?.(node)?'menuEdit':'sectionEdit');
    Object.assign(outline.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
    // Prefer the area outside the section. A floating action over the first
    // line would eat its clicks in narrow canvases and small text sections.
    const buttonHeight=actions.offsetHeight;
    const above=rect.top-buttonHeight, below=rect.bottom;
    actions.style.top=(above>=0?above:Math.min(win.innerHeight-buttonHeight,below))+'px';
    actions.style.left=Math.max(0,Math.min(win.innerWidth,rect.right)-actions.offsetWidth)+'px';
  }
  function schedule(){if(!timer)timer=win.requestAnimationFrame(position);}
  function showPaint(control,name,value){
    const transparent=value==='transparent'||value==='rgba(0, 0, 0, 0)';
    control.style.setProperty('--website-paint',value);
    paintLabels.get(name).textContent=transparent?t('sectionTransparent'):colour(value)||value;
  }
  function refresh() {
    const text=styleRange(range,body);
    scope.querySelector('[value="selection"]').disabled=!text;
    scope.querySelector('[value="section"]').disabled=!selected;
    scope.querySelector('[value="site"]').disabled=component||!getCSS||!setCSS;
    scope.querySelector('[value="page"]').disabled=component;
    if(scope.selectedOptions[0]?.disabled)scope.value=selected||component?'section':'page';
    const selectionScope=scope.value==='selection', site=scope.value==='site';
    const target=(selectionScope?element(range.startContainer):scope.value==='section'?selected:body)??body;
    const inline=readVisualStyle(document,getCSS(),site?'site':visualClass(target));
    const computed=win.getComputedStyle(target);
    for(const field of fields){
      const control=controls.get(field.name),value=inline.getPropertyValue(field.name),resolved=computed.getPropertyValue(field.name);
      if(field.type==='color'){
        control.value=colour(resolved)||'#000000';showPaint(control,field.name,resolved);
      }else if(field.type==='number'){
        control.value=field.unit?(/^[-.\d]+px$/.test(value)?parseFloat(value):''):(value&&Number.isFinite(Number(value))?value:'');
        const lineRatio=field.name==='line-height'&&resolved.endsWith('px')?parseFloat(resolved)/parseFloat(computed.fontSize):NaN;
        control.placeholder=Number.isFinite(lineRatio)?String(Number(lineRatio.toFixed(3))):resolved;
      }else{
        control.options[0].textContent=t('sectionInherit')+' · '+resolved;
        control.value=[...control.options].find(o=>o.value.replaceAll(' ','')===value.replaceAll(' ',''))?.value??'';
      }
      control.disabled=scope.value==='section'&&!!selected?.hasAttribute('data-website-feed')||selectionScope&&['padding','text-align'].includes(field.name);
    }
    touched.clear();apply.disabled=true;reset.disabled=scope.value==='section'&&!!selected?.hasAttribute('data-website-feed');
    edit.hidden=!selected;
    edit.disabled=!selected||!editableText(selected,document);
    edit.title=edit.disabled?t('sectionNoText'):'';
    prompt.hidden=!!selected;
    responsive.refresh();
  }
  function setSelected(node, scroll=false, fromOutline=false) {
    node=node?.closest('[data-website-feed]')??node;
    if (!node || !(node.matches(blocks)||(fromOutline&&node.matches(outlineContents))) || node.closest(chrome)) return;
    const same=node===selected;
    selected=node;hover=null;
    if(!same){
      range=null;scope.value='section';observer.disconnect();observer.observe(node);
      activePath=pathOf(node,body);onSelect?.({path:activePath});refresh();
    }
    if(scroll)node.scrollIntoView({block:'nearest',inline:'nearest'});schedule();
  }
  function editSelected(){
    const text=editableText(selected,document);if(!text)return;
    const leaf=text.parentElement.closest('[contenteditable="true"]');
    leaf?.focus({preventScroll:true});const caret=document.createRange();caret.setStart(text,0);caret.collapse(true);
    const selection=win.getSelection();selection.removeAllRanges();selection.addRange(caret);text.parentElement.scrollIntoView({block:'nearest'});schedule();
  }
  listen(action,'click',()=>{const node=hover??selected,menu=openMenu&&menuTarget?.(node);if(menu){openMenu(menu);return;}setSelected(node);editSelected();});
  layerDrag?.bindGrip(grip,()=>hover??selected,signal);
  listen(edit,'click',editSelected);
  listen(scope,'change',refresh);
  listen(body,'pointerover',event=>{
    if(frame.contains(event.target))return;
    const node=element(event.target)?.closest(blocks);
    if(hover!==node){hover=node;schedule();}
  });
  listen(body,'pointerleave',()=>{hover=null;schedule();});
  listen(document,'click',event=>{
    if(frame.contains(event.target))return;
    table.select(event.target);
    const target=element(event.target),control=target?.closest(interactiveSelector);
    if(control&&!control.closest('nav,'+chrome+','+protectedNodes))setSelected(control,false,true);
    else{const node=target?.closest(blocks);if(node)setSelected(node);}
  });
  listen(document,'selectionchange',()=>{
    const selection=win.getSelection();if(!selection.rangeCount)return;
    const next=selection.getRangeAt(0);
    table.select(next.startContainer);
    if(styleRange(next,body)){
      const node=element(next.startContainer).closest(blocks);
      if(node)setSelected(node);
      range=next.cloneRange();scope.querySelector('[value="selection"]').disabled=false;
    }else if(host.activeElement?.contentDocument===document){
      range=null;scope.querySelector('[value="selection"]').disabled=true;
      if(scope.value==='selection')refresh();
    }
  });
  listen(body,'beforeinput',event=>{
    // Chromium supplies the exact range about to be deleted or replaced,
    // including neighbouring markup for Backspace and forward Delete.
    for(const candidate of event.getTargetRanges()){
      const target=document.createRange();target.setStart(candidate.startContainer,candidate.startOffset);target.setEnd(candidate.endContainer,candidate.endOffset);
      if(!safeRange(target,body)){event.preventDefault();return;}
    }
  },{capture:true});
  listen(document,'scroll',schedule,{capture:true,passive:true});listen(win,'resize',schedule);

  function commit(resetAll) {
    if(scope.value==='section'&&selected?.hasAttribute('data-website-feed'))return;
    const selectionScope=scope.value==='selection',site=scope.value==='site';
    if(selectionScope&&!styleRange(range,body))return;
    const changes=new Map();
    for(const field of fields){
      const control=controls.get(field.name);
      if(control.disabled||(!resetAll&&!touched.has(field.name)))continue;
      if(!resetAll&&!control.reportValidity())return;
      changes.set(field.name,resetAll||!control.value?'':control.value+(field.unit??''));
    }
    if(!changes.size)return;
    let css=getCSS(), canvasCSS=savedStyle.textContent;
    function write(name, text=false) {
      const style=readVisualStyle(document,css,name);applyVisualStyle(style,changes,{text});
      css=writeVisualStyle(css,name,style);canvasCSS=writeVisualStyle(canvasCSS,name,style);
    }
    if(selectionScope){
      // Style individual text runs, in place. Emphasis, links and the DOM
      // ancestry of each word survive selections spanning multiple inline tags.
      const runs=websiteTextRuns(document,range);
      if(!runs.length)return;
      beforeChange();
      const name='ow-visual-'+crypto.randomUUID();
      for(const run of runs){
        let text=run.node;
        if(run.end<text.length)text.splitText(run.end);if(run.start)text=text.splitText(run.start);
        let span=text.parentElement;
        if(!resetAll){
          span=document.createElement('span');text.replaceWith(span);span.append(text);
          span.className=name;
        }else if(span.tagName==='SPAN'&&span.childNodes.length===1&&span.attributes.length===1&&span.classList.length===1&&visualClass(span)){
          span.replaceWith(text);
        }
        run.text=text;
      }
      if(!resetAll)write(name,true);
      range=document.createRange();range.setStart(runs[0].text,0);range.setEnd(runs.at(-1).text,runs.at(-1).text.length);change();
    } else if(site){
      beforeChange();write('site');
    } else {
      const target=scope.value==='section'?selected:body;if(!target||target.closest(linked))return;
      const previous=visualClass(target);if(resetAll&&!previous)return;
      beforeChange();
      const name=previous??'ow-visual-'+crypto.randomUUID();
      if(resetAll)target.classList.remove(name);else target.classList.add(name);
      write(name);change();
    }
    persistStyle(css,canvasCSS);
    refresh();schedule();
  }
  function persistStyle(css,canvasCSS){
    if(css!==getCSS()){
      // Hand-authored pages can omit the shared stylesheet. Link it on the
      // first actual style change, keeping untouched HTML byte-for-byte saved.
      if(stylesheet&&!document.querySelector('link[data-observanda-editor-stylesheet]')){
        const from=new URL('.',document.location.href),to=new URL(stylesheet,from);
        if(from.origin===to.origin){
          const a=from.pathname.split('/').slice(1,-1),b=to.pathname.split('/').slice(1);
          let i=0;while(i<a.length && a[i]===b[i])i++;
          const link=document.createElement('link');link.rel='stylesheet';
          link.dataset.observandaEditorStylesheet='../'.repeat(a.length-i)+b.slice(i).join('/');
          document.head.append(link);change();
        }
      }
      savedStyle.textContent=canvasCSS;setCSS(css);
    }
  }
  listen(form,'submit',event=>{event.preventDefault();commit(false);});
  listen(reset,'click',()=>commit(true));
  refresh();
  return {
    styleTarget(){return (styleRange(range,body)?element(range.startContainer):selected)??body;},
    textStyleSelection(){return styleRange(range,body)?pinStyleText(document,range):null;},
    viewportChanged(){responsive.refresh();schedule();},
    select(path,{edit:focus=false}={}){
      if(typeof path!=='string'||!/^\d+(?:\/\d+)*$/.test(path))return false;
      let node=body;for(const index of path.split('/'))node=node?.children[Number(index)];
      if(!node||!(node.matches(blocks)||node.matches(outlineContents))||node.closest(chrome))return false;
      setSelected(node,true,true);table.select(node);if(focus)editSelected();return true;
    },
    destroy(){
      controller.abort();table.destroy();observer.disconnect();if(timer)win.cancelAnimationFrame(timer);
      for(const link of links){const value=link.dataset.observandaEditorEditable;if(value==='absent')link.removeAttribute('contenteditable');else link.setAttribute('contenteditable',value);delete link.dataset.observandaEditorEditable;}
      frame.remove();sheet.remove();form.remove();
    }
  };
}
