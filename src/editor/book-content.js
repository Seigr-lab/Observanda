import {BOOK_BLOCKS,validBookBlock,renderBookBlock} from '../web/book-blocks.js';
import {bookText} from '../web/book-messages.js';
import {closeHistory} from 'prosemirror-history';
import {NodeSelection} from 'prosemirror-state';
import {recordFigure} from '../web/book-reading.js';
import {newSketch} from '../web/sketch-model.js';
import {sketchEditor} from './sketch-editor.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function bookContentEditor({view,schema,toolbar,figures=()=>[],validate=()=>true,message=bookText}){
 let panel=null,position=null,selection=null,type='book_table',attrs=null,sketch=null;
 const label=(key,control)=>'<label>'+esc(message(key))+control+'</label>';
 const input=(key,max=1000)=>label(key,`<input name="${key}" maxlength="${max}" value="${esc(attrs[key]??'')}">`);
 const area=(key,max=60000)=>label(key,`<textarea name="${key}" maxlength="${max}" rows="4">${esc(attrs[key]??'')}</textarea>`);
 const button=(key)=>`<button class="button" type="button" data-book-action="${key}">${esc(message(key))}</button>`;
 function fresh(kind){const base={version:1,id:crypto.randomUUID()};if(kind==='book_sketch')return newSketch(base.id);return {...base,...({book_table:{title:'',headers:['',''],rows:[['','']]},book_equation:{source:'',label:''},book_citation:{title:'',authors:'',issued:'',locator:'',url:''},book_figure:{figureId:figures()[0]?.id??'',alternative:''},book_preserved:{format:'',source:'',reason:''}}[kind])};}
 function collect(){for(const el of panel.querySelectorAll('[name]'))if(Object.hasOwn(attrs,el.name))attrs[el.name]=el.value;for(const el of panel.querySelectorAll('[data-cell]')){const [r,c]=el.dataset.cell.split(':').map(Number);if(r===-1)attrs.headers[c]=el.value;else attrs.rows[r][c]=el.value;}}
 function paint(){
  sketch?.destroy();sketch=null;
  const fields=type==='book_table'?input('title',300)+'<p>'+esc(message('tableHint'))+'</p><div class="book-table-scroll"><table><thead><tr>'+attrs.headers.map((v,c)=>`<th><input data-cell="-1:${c}" aria-label="${esc(message('headers'))} ${c+1}" maxlength="500" value="${esc(v)}"></th>`).join('')+'</tr></thead><tbody>'+attrs.rows.map((r,i)=>'<tr>'+r.map((v,c)=>`<td><textarea data-cell="${i}:${c}" aria-label="${esc(message('row'))} ${i+1}, ${c+1}" maxlength="10000">${esc(v)}</textarea></td>`).join('')+'</tr>').join('')+'</tbody></table></div><div class="inline-actions">'+['addRow','removeRow','addColumn','removeColumn'].map(button).join('')+'</div>':
   type==='book_sketch'?input('title',300)+area('description',20000)+'<div data-sketch-editor></div>':
   type==='book_equation'?'<p>'+esc(message('equationHint'))+'</p>'+area('source',4000)+input('label'):
   type==='book_citation'?input('title')+input('authors',2000)+input('issued',200)+input('locator')+input('url',2000):
   type==='book_figure'?label('figureId','<select name="figureId">'+figures().map(f=>`<option value="${esc(f.id)}"${attrs.figureId===f.id?' selected':''}>${esc(f.title||f.caption||f.alt||f.id)}</option>`).join('')+'</select>')+area('alternative',20000):'<p>'+esc(message('preservedHint'))+'</p>'+input('format',200)+area('source')+area('reason',2000);
  panel.innerHTML='<h3>'+esc(message(position===null?'insert':'edit'))+'</h3>'+label('kind','<select data-book-kind>'+BOOK_BLOCKS.map(v=>'<option value="'+v+'"'+(type===v?' selected':'')+'>'+esc(message(v.slice(5)==='preserved'?'preserved':v.slice(5)))+'</option>').join('')+'</select>')+fields+'<p role="alert" data-book-error></p><footer class="inline-actions">'+button('cancel')+button('apply')+'</footer>';
  if(type==='book_sketch')sketch=sketchEditor(panel.querySelector('[data-sketch-editor]'),attrs);
 }
 function close(){sketch?.destroy();sketch=null;panel?.close();panel?.remove();panel=null;view.focus();}
 function open({edit=false}={}){
  if(panel)return;selection=view.state.selection;const n=selection.node;position=edit&&BOOK_BLOCKS.includes(n?.type.name)?selection.from:null;type=position===null?'book_table':n.type.name;attrs=position===null?fresh(type):structuredClone(n.attrs);
  panel=toolbar.ownerDocument.createElement('dialog');panel.className='book-content-panel';panel.setAttribute('aria-label',message('content'));toolbar.append(panel);paint();
  panel.addEventListener('cancel',e=>{e.preventDefault();close();});panel.addEventListener('change',e=>{if(e.target.matches('[data-book-kind]')){type=e.target.value;attrs=fresh(type);paint();}});
  panel.addEventListener('input',()=>{if(type==='book_sketch')collect();});
  panel.addEventListener('click',e=>{const action=e.target.closest('[data-book-action]')?.dataset.bookAction;if(!action)return;if(action==='cancel'){close();return;}collect();
   if(action==='addRow'&&attrs.rows.length<500)attrs.rows.push(attrs.headers.map(()=>''));if(action==='removeRow'&&attrs.rows.length>1)attrs.rows.pop();
   if(action==='addColumn'&&attrs.headers.length<20){attrs.headers.push('');attrs.rows.forEach(r=>r.push(''));}if(action==='removeColumn'&&attrs.headers.length>1){attrs.headers.pop();attrs.rows.forEach(r=>r.pop());}
   if(action==='apply'){
    if(sketch&&!sketch.ready())return;
    if(!validBookBlock({type,attrs})){panel.querySelector('[data-book-error]').textContent=message('invalid');return;}
    const node=schema.nodes[type].create(attrs),tr=closeHistory(view.state.tr);
    if(position!==null)tr.replaceWith(position,position+view.state.doc.nodeAt(position).nodeSize,node);else if(selection.node)tr.insert(selection.to,node);else tr.setSelection(selection).replaceSelectionWith(node);
    if(!validate(tr.doc.toJSON())){panel.querySelector('[data-book-error]').textContent=message('documentLimit');return;}
    view.dispatch(tr.scrollIntoView());close();return;
   }paint();
  });panel.showModal();panel.querySelector('input,textarea,select')?.focus();
 }
 const click=e=>{if(e.target.closest('[data-rich-command="book"]'))open();};toolbar.addEventListener('click',click);
 return {destroy(){toolbar.removeEventListener('click',click);sketch?.destroy();panel?.remove();},open};
}
export function bookNodeView({edit,figures=()=>[]}){return (node,view,getPos)=>{
 const dom=view.dom.ownerDocument.createElement('div');dom.className='book-content-node';dom.contentEditable='false';dom.setAttribute('data-book-node',JSON.stringify(node.toJSON()));
 const available=figures()??[],record={figures:available.filter(f=>f.kind!=='image'),attachments:available.filter(f=>f.kind==='image')};
 dom.innerHTML=renderBookBlock(node.toJSON(),{esc,figure:id=>recordFigure(record,id,esc)})+'<button type="button" data-book-edit>'+esc(bookText('edit'))+'</button>';
 dom.querySelector('[data-book-edit]').addEventListener('click',()=>{view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc,getPos())));edit();});
 return {dom,stopEvent:e=>!!e.target.closest('button,details,summary'),ignoreMutation:()=>true};
};}
