import {DOMParser,Fragment,Slice} from 'prosemirror-model';
import {EditorState,TextSelection} from 'prosemirror-state';
import {BOOK_BLOCKS,validBookBlock} from '../web/book-blocks.js';
import {bookContentEditor,bookNodeView} from './book-content.js';
import {bookText} from '../web/book-messages.js';
import {EditorView} from 'prosemirror-view';
import {baseKeymap,toggleMark,setBlockType,wrapIn,lift,chainCommands,exitCode} from 'prosemirror-commands';
import {history,undo,redo,closeHistory} from 'prosemirror-history';
import {keymap} from 'prosemirror-keymap';
import {wrapInList,splitListItem,sinkListItem,liftListItem} from 'prosemirror-schema-list';
import {schema} from './schema.js';
import {collab,getVersion,sendableSteps,receiveTransaction} from 'prosemirror-collab';
import {Step} from 'prosemirror-transform';
import {safeRichLink,validRichText,plainRichText} from '../web/rich-text-model.js';
import {formattedText} from '../web/formatted-text.js';

export function mountRichText({mount,toolbar,section,onChange,onError,initialState,revealSelection,label="Section text",onOpenLink,getDestinations,getFigures,maxCharacters=60000,collaboration=null}) {
 const controller=new AbortController(),opts={signal:controller.signal};let view;
 let doc;
 if(section.richText)doc=schema.nodeFromJSON(section.richText);
 else if(section.format==='markdown'){const holder=mount.ownerDocument.createElement('div');holder.innerHTML=formattedText(section.body,'markdown');doc=DOMParser.fromSchema(schema).parse(holder);}
 else doc=schema.nodeFromJSON(plainRichText(section.body));
 function ancestor(type){const {$from}=view.state.selection;for(let d=$from.depth;d>0;d--)if($from.node(d).type===type)return true;return false;}
 function list(type){return (state,dispatch)=>{if(ancestor(type))return liftListItem(schema.nodes.list_item)(state,dispatch);for(const other of [schema.nodes.bullet_list,schema.nodes.ordered_list])if(ancestor(other)){const {$from}=state.selection;for(let d=$from.depth;d>0;d--)if($from.node(d).type===other){dispatch?.(state.tr.setNodeMarkup($from.before(d),type,type===schema.nodes.ordered_list?{order:1}:{}));return true;}}return wrapInList(type)(state,dispatch);};}
 const commands={subscript:toggleMark(schema.marks.subscript),superscript:toggleMark(schema.marks.superscript),bold:toggleMark(schema.marks.strong),italic:toggleMark(schema.marks.em),underline:toggleMark(schema.marks.underline),strike:toggleMark(schema.marks.strike),code:toggleMark(schema.marks.code),bullet:list(schema.nodes.bullet_list),numbered:list(schema.nodes.ordered_list),quote:(s,d)=>ancestor(schema.nodes.blockquote)?lift(s,d):wrapIn(schema.nodes.blockquote)(s,d),indent:sinkListItem(schema.nodes.list_item),outdent:liftListItem(schema.nodes.list_item),undo,redo};
 const keys={'Mod-k':()=>{toolbar.querySelector('[data-rich-command=link]')?.click();return true;},'Mod-b':commands.bold,'Mod-i':commands.italic,'Mod-u':commands.underline,'Mod-z':undo,'Mod-Shift-z':redo,'Mod-y':redo,Enter:splitListItem(schema.nodes.list_item),Tab:commands.indent,'Shift-Tab':commands.outdent,'Shift-Enter':chainCommands(exitCode,(s,dispatch)=>{dispatch?.(s.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());return true;})};
 // A native End/arrow movement can precede selectionchange in a parent-hosted
 // iframe editor. Commands must use the visible caret, not the older selection.
 function syncCaret(v,event){
  if(event.isComposing||v.composing)return false;
  const selection=v.dom.ownerDocument.getSelection();
  if(!selection?.isCollapsed||!selection.anchorNode||!v.dom.contains(selection.anchorNode))return false;
  const position=v.posAtDOM(selection.anchorNode,selection.anchorOffset);
  if(v.state.doc.resolve(position).parent.inlineContent){
   const next=TextSelection.create(v.state.doc,position);
   if(!next.eq(v.state.selection))v.dispatch(v.state.tr.setSelection(next));
  }
  return false;
 }
 mount.replaceChildren();
 const identity=tr=>{const ids=new Set();tr.doc.descendants((n,pos)=>{if(n.type===schema.nodes.heading||BOOK_BLOCKS.includes(n.type.name)){if(!n.attrs.id||ids.has(n.attrs.id))tr.setNodeMarkup(pos,null,{...n.attrs,id:crypto.randomUUID()});ids.add(tr.doc.nodeAt(pos).attrs.id);}});return tr;};
 view=new EditorView({mount},{state:initialState?.doc.eq(doc)?initialState:EditorState.create({schema,doc,plugins:[history(),keymap(keys),keymap(baseKeymap),...(collaboration?[collab({version:collaboration.version,clientID:collaboration.clientId})]:[])]}),attributes:state=>({role:'textbox','aria-label':label,'aria-multiline':'true','data-empty':String(!state.doc.textContent.length)}),handleScrollToSelection:revealSelection,handleClick:()=>false,handleDOMEvents:{keydown:syncCaret,click:(v,event)=>{const a=event.target.closest('a');if(a){event.preventDefault();if((event.ctrlKey||event.metaKey)&&onOpenLink)onOpenLink(a.getAttribute('href'));}return false;}},dispatchTransaction(tr){
   if(tr.docChanged)identity(tr);const next=view.state.apply(tr);if(tr.docChanged&&!validRichText(next.doc.toJSON(),{maxCharacters})){onError('This text exceeds the supported document structure or size.');return;}
   view.updateState(next);if(tr.docChanged)onChange(next.doc.toJSON());update();
 }});
 // A paste creates a copy even between independent section editors.
 const copied=fragment=>Fragment.fromArray(fragment.content.map(n=>n.isText?n:n.type.create({...n.attrs,...(n.attrs.id?{id:crypto.randomUUID()}:{})},copied(n.content),n.marks)));
 const contentEditor=bookContentEditor({view,schema,toolbar,figures:getFigures,validate:doc=>validRichText(doc,{maxCharacters})});
 const dragCopies=event=>event.ctrlKey||event.metaKey||event.altKey;let movingContent=false;
 view.setProps({dragCopies,handleDOMEvents:{...view.props.handleDOMEvents,drop:(v,event)=>{movingContent=!!v.dragging&&!dragCopies(event);queueMicrotask(()=>{movingContent=false;});return false;}},transformPasted:slice=>movingContent?slice:new Slice(copied(slice.content),slice.openStart,slice.openEnd),nodeViews:Object.fromEntries(BOOK_BLOCKS.map(type=>[type,bookNodeView({figures:getFigures,edit:()=>contentEditor.open({edit:true})})])),handlePaste:(v,event)=>{
  const html=event.clipboardData?.getData('text/html')??'';
  // A serialized Observanda block is admitted by its validated data, not by a
  // marker elsewhere in the pasted document. Mixed unsupported HTML stays out.
  if(/<(?:table|math|svg|iframe|script|object)\b/i.test(html)){
   const holder=mount.ownerDocument.createElement('template');holder.innerHTML=html;
   const unsupported=[...holder.content.querySelectorAll('table,math,svg,iframe,script,object')].some(el=>{try{return !validBookBlock(JSON.parse(el.closest('[data-book-node]')?.getAttribute('data-book-node')??'null'));}catch{return true;}});
   if(unsupported){onError(bookText('unsupportedPaste'));return true;}
  }
  return false;
 }});
 function active(type){const {from,to,empty,$from}=view.state.selection;return empty?Boolean(type.isInSet(view.state.storedMarks??$from.marks())):view.state.doc.rangeHasMark(from,to,type);}
 function update(){for(const [key,mark] of Object.entries({bold:'strong',italic:'em',underline:'underline',strike:'strike',code:'code',subscript:'subscript',superscript:'superscript'}))toolbar.querySelector(`[data-rich-command="${key}"]`)?.setAttribute('aria-pressed',String(active(schema.marks[mark])));for(const key of ['undo','redo','indent','outdent']){const b=toolbar.querySelector(`[data-rich-command="${key}"]`);if(b)b.disabled=!commands[key](view.state);}
  const size=toolbar.querySelector('[data-rich-size]');if(size){const {from,to,empty,$from}=view.state.selection,values=new Set();if(empty)values.add(schema.marks.text_size.isInSet(view.state.storedMarks??$from.marks())?.attrs.size??'');else view.state.doc.nodesBetween(from,to,node=>{if(node.isText)values.add(schema.marks.text_size.isInSet(node.marks)?.attrs.size??'');});size.value=values.size>1?'mixed':[...values][0]??'';}
  const font=toolbar.querySelector('[data-rich-font]');if(font){const {from,to,empty,$from}=view.state.selection,values=new Set();if(empty)values.add(schema.marks.font_family.isInSet(view.state.storedMarks??$from.marks())?.attrs.font??'');else view.state.doc.nodesBetween(from,to,node=>{if(node.isText)values.add(schema.marks.font_family.isInSet(node.marks)?.attrs.font??'');});font.value=values.size>1?'mixed':[...values][0]??'';font.dispatchEvent(new Event('fontselectionchange'));}
  for(const key of ['bullet','numbered','quote'])toolbar.querySelector(`[data-rich-command="${key}"]`)?.setAttribute('aria-pressed',String(ancestor(schema.nodes[{bullet:'bullet_list',numbered:'ordered_list',quote:'blockquote'}[key]])));
  for(const input of toolbar.querySelectorAll('[data-rich-color]')){const mark=schema.marks[input.dataset.richColor].isInSet(view.state.storedMarks??view.state.selection.$from.marks());if(mark)input.value=mark.attrs.color;input.parentElement.style.setProperty('--chosen-color',input.value);}
  const parent=view.state.selection.$from.parent,style=toolbar.querySelector('[data-rich-block]');for(const align of ['start','center','end','justify'])toolbar.querySelector(`[data-rich-command="align-${align}"]`)?.setAttribute('aria-pressed',String(parent.attrs.align===align));if(style)style.value=parent.type===schema.nodes.heading?'h'+parent.attrs.level:parent.type===schema.nodes.code_block?'code':'paragraph';const codeLanguage=toolbar.querySelector('[data-code-language]');if(codeLanguage){codeLanguage.hidden=parent.type!==schema.nodes.code_block;codeLanguage.value=parent.attrs.language??'';}
 }
 function run(command){if(command!==undo&&command!==redo)view.dispatch(closeHistory(view.state.tr));command(view.state,view.dispatch,view);if(command!==undo&&command!==redo)view.dispatch(closeHistory(view.state.tr));view.focus();update();}
 function linkRange(){const {from,to,$from}=view.state.selection;if(from!==to)return {from,to};const mark=schema.marks.link.isInSet($from.marks())??schema.marks.link.isInSet($from.nodeAfter?.marks??[]);if(!mark)return {from,to};let start=$from.start(),left=null,right=null;$from.parent.forEach(node=>{const end=start+node.nodeSize;if(mark.isInSet(node.marks)){if(start<=from&&end>=from){left??=start;right=end;}else if(right===start)right=end;}start=end;});if(left===null)return {from,to};while(left>$from.start()){const before=view.state.doc.resolve(left).nodeBefore;if(!before||!mark.isInSet(before.marks))break;left-=before.nodeSize;}return {from:left,to:right,mark};}

 let shownDestinations=60,destinationRequest=0,destinationController=null,destinationPage=null,destinationCursor=null;
 async function fillDestinations(cursor=null,{focus=false}={}){
  if(!getDestinations)return;
  const request=++destinationRequest,panel=toolbar.querySelector('.rich-link-panel'),host=panel.querySelector('.text-link-targets'),query=panel.querySelector('[data-rich-search]').value.trim().toLowerCase();
  destinationController?.abort();const pending=new AbortController();destinationController=pending;destinationCursor=cursor;
  const abort=()=>pending.abort();controller.signal.addEventListener('abort',abort,{once:true});
  host.setAttribute('aria-busy','true');host.textContent='Loading destinations...';
  const button=(label,key)=>{const b=host.ownerDocument.createElement('button');b.type='button';b.dataset.richPage=key;b.textContent=label;host.append(b);};
  try{
   const result=await getDestinations({query,cursor,signal:destinationController.signal});
   if(request!==destinationRequest||controller.signal.aborted||panel.hidden||!toolbar.isConnected)return;
   const legacy=Array.isArray(result),items=legacy?result.filter(item=>(item.label+' '+(item.context??'')).toLowerCase().includes(query)):result.items;
   destinationPage=legacy?null:result;host.replaceChildren();
   for(const item of legacy?items.slice(0,shownDestinations):items){
    const b=host.ownerDocument.createElement('button');b.type='button';b.dataset.richDestination=item.href;b.dataset.richLabel=item.label;
    const title=host.ownerDocument.createElement('strong'),context=host.ownerDocument.createElement('small');title.textContent=item.label;context.textContent=item.context??'';b.append(title,context);host.append(b);
   }
   if(legacy&&items.length>shownDestinations){const more=host.ownerDocument.createElement('button');more.type='button';more.dataset.richMore='';more.textContent='Show more destinations ('+(items.length-shownDestinations)+' remaining)';host.append(more);}
   if(!items.length){const empty=host.ownerDocument.createElement('p');empty.textContent='No matching destinations. You can paste a copied research reference below.';host.append(empty);}
   if(result.previousCursor)button('Previous destinations','previous');if(result.nextCursor)button('Next destinations','next');
   if(focus)host.querySelector('button')?.focus();
  }catch(error){
   if(request!==destinationRequest||controller.signal.aborted||panel.hidden||!toolbar.isConnected||error.name==='AbortError')return;
   host.replaceChildren();const message=host.ownerDocument.createElement('p');message.setAttribute('role','alert');message.textContent=error.message??'Could not load destinations.';host.append(message);button('Retry destinations','retry');if(focus)host.querySelector('button')?.focus();
  }finally{controller.signal.removeEventListener('abort',abort);if(request===destinationRequest)host.removeAttribute('aria-busy');}
 }
 let linkSelection=null;
 toolbar.addEventListener('mousedown',event=>{if(event.target.closest('button[data-rich-command]'))event.preventDefault();},opts);
 toolbar.addEventListener('click',event=>{
  const pager=event.target.closest('[data-rich-page]');if(pager){void fillDestinations(pager.dataset.richPage==='next'?destinationPage?.nextCursor:pager.dataset.richPage==='previous'?destinationPage?.previousCursor:destinationCursor,{focus:true});return;}
  if(event.target.closest('[data-rich-more]')){shownDestinations+=60;fillDestinations();return;}
  const destination=event.target.closest('[data-rich-destination]');
  if(destination){const panel=toolbar.querySelector('.rich-link-panel');panel.querySelector('[name=href]').value=destination.dataset.richDestination;if(!panel.querySelector('[name=label]').value)panel.querySelector('[name=label]').value=destination.dataset.richLabel;panel.querySelector('[data-rich-command=link-apply]').focus();return;}
  const button=event.target.closest('[data-rich-command]');if(!button)return;const command=button.dataset.richCommand;
  if(commands[command])return run(commands[command]);
  if(command==='link-open'){
   const href=toolbar.querySelector('[name=href]').value;if(!safeRichLink(href))return;
   toolbar.querySelector('.rich-link-panel').close();toolbar.querySelector('.rich-link-panel').hidden=true;if(onOpenLink)onOpenLink(href);else if(/^(https?:|mailto:|tel:)/.test(href))window.open(href,'_blank','noopener,noreferrer');return;
  }
  if(command==='clear'){const {from,to}=view.state.selection;view.dispatch(closeHistory(view.state.tr));view.dispatch(view.state.tr.removeMark(from,to).setStoredMarks([]));view.dispatch(closeHistory(view.state.tr));view.focus();return;}
  if(command==='link'){linkSelection=linkRange();const panel=toolbar.querySelector('.rich-link-panel'),a=linkSelection.mark?.attrs??{};panel.hidden=false;panel.querySelector('[name=href]').value=a.href??'';panel.querySelector('[name=title]').value=a.title??'';panel.querySelector('[name=target]').value=a.target??'_self';panel.querySelector('[name=nofollow]').checked=a.nofollow??false;panel.querySelector('[name=label]').value=view.state.doc.textBetween(linkSelection.from,linkSelection.to,' ');panel.querySelector('[data-rich-search]').value='';shownDestinations=60;fillDestinations();panel.showModal();panel.querySelector('[data-rich-search]').focus();return;}
  if(command==='link-cancel'){const panel=toolbar.querySelector('.rich-link-panel');panel.close();panel.hidden=true;view.focus();return;}
  if(command==='link-apply'||command==='link-remove'){
   view.dispatch(closeHistory(view.state.tr));
   const panel=toolbar.querySelector('.rich-link-panel'),href=panel.querySelector('[name=href]'),label=panel.querySelector('[name=label]').value.trim(),range=linkSelection??linkRange();
   href.setCustomValidity('');if(command==='link-apply'&&!safeRichLink(href.value)){href.setCustomValidity('Use a web address, email link, phone link or page destination.');href.reportValidity();return;}
   let tr=view.state.tr.removeMark(range.from,range.to,schema.marks.link);
   if(command==='link-apply'){const text=label||view.state.doc.textBetween(range.from,range.to,' ')||href.value;const replace=range.from===range.to||text!==view.state.doc.textBetween(range.from,range.to,' ');if(replace)tr=tr.insertText(text,range.from,range.to);const end=replace?range.from+text.length:range.to;tr=tr.addMark(range.from,end,schema.marks.link.create({href:href.value,title:panel.querySelector('[name=title]').value,target:panel.querySelector('[name=target]').value,nofollow:panel.querySelector('[name=nofollow]').checked})).setSelection(TextSelection.create(tr.doc,end));}
   view.dispatch(tr.scrollIntoView());panel.close();panel.hidden=true;view.focus();return;
  }
  if(command.startsWith('align-')){view.dispatch(closeHistory(view.state.tr));let tr=view.state.tr;const {from,to}=view.state.selection;view.state.doc.nodesBetween(from,to,(node,pos)=>{if(node.type===schema.nodes.paragraph||node.type===schema.nodes.heading)tr=tr.setNodeMarkup(pos,null,{...node.attrs,align:command.slice(6)});});view.dispatch(tr);view.dispatch(closeHistory(view.state.tr));view.focus();}
 },opts);
 function setMark(type,attrs){view.dispatch(closeHistory(view.state.tr));const {from,to,empty}=view.state.selection;let tr=view.state.tr;if(empty)tr=attrs?tr.addStoredMark(type.create(attrs)):tr.removeStoredMark(type);else tr=attrs?tr.addMark(from,to,type.create(attrs)):tr.removeMark(from,to,type);view.dispatch(tr);view.dispatch(closeHistory(view.state.tr));view.focus();}
 toolbar.addEventListener('change',event=>{
  const el=event.target;
  if(el.matches('[data-code-language]')){const {$from}=view.state.selection;if($from.parent.type===schema.nodes.code_block)view.dispatch(view.state.tr.setNodeMarkup($from.before(),null,{language:el.value}));}
  if(el.matches('[data-rich-size]')){const size=Number(el.value);setMark(schema.marks.text_size,size?{size}:null);}
  if(el.matches('[data-rich-font]')){const font=el.value;setMark(schema.marks.font_family,font?{font}:null);}
  if(el.matches('[data-rich-color]'))setMark(schema.marks[el.dataset.richColor],{color:el.value.toLowerCase()});
  if(el.matches('[data-rich-block]')){const value=el.value;run(setBlockType(value==='code'?schema.nodes.code_block:value.startsWith('h')?schema.nodes.heading:schema.nodes.paragraph,value.startsWith('h')?{level:Number(value[1]),align:view.state.selection.$from.parent.attrs.align??'inherit'}:{align:view.state.selection.$from.parent.attrs.align??'inherit'}));}
 },opts);
 toolbar.addEventListener('keydown',event=>{if(event.key==='Escape'&&!toolbar.querySelector('.rich-link-panel').hidden){event.preventDefault();const panel=toolbar.querySelector('.rich-link-panel');panel.close();panel.hidden=true;view.focus();}},opts);
 toolbar.querySelector('[name=href]')?.addEventListener('input',event=>event.target.setCustomValidity(''),opts);
 const panel=toolbar.querySelector('.rich-link-panel');
 panel.addEventListener('cancel',event=>{event.preventDefault();panel.close();panel.hidden=true;view.focus();},opts);
 toolbar.querySelector('[data-rich-search]')?.addEventListener('input',event=>{
  if(getDestinations){shownDestinations=60;fillDestinations();return;}
  const words=event.target.value.toLowerCase().trim().split(/\s+/);for(const button of toolbar.querySelectorAll('[data-rich-destination]'))button.hidden=!words.every(word=>button.dataset.richMatch.includes(word));
 },opts);
 update();return {focus:()=>{view.focus();view.dispatch(view.state.tr.scrollIntoView());},get state(){return view.state;},destroy(){controller.abort();contentEditor.destroy();view.destroy();},get doc(){return view.state.doc.toJSON();},
 get collaboration(){if(!collaboration)return null;const pending=sendableSteps(view.state);return {version:getVersion(view.state),steps:pending?.steps.map(s=>s.toJSON())??[],clientId:collaboration.clientId};},
 receive(steps,clients){if(!collaboration)return;const tr=receiveTransaction(view.state,steps.map(s=>Step.fromJSON(schema,s)),clients);view.updateState(view.state.apply(tr));update();},
 replaceDocument(document){const doc=schema.nodeFromJSON(document);view.dispatch(view.state.tr.replaceWith(0,view.state.doc.content.size,doc.content));}};
}
