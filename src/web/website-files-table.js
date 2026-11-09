// These controls edit the authored HTML table in the canvas. Converted
// records and linked content remain under their own publication permissions.
import {readDelimitedTable,MAX_TABLE_TEXT} from './tabular-data.js';
import {websiteTableGrid,editWebsiteAxis,moveWebsiteAxis,mergeWebsiteCells,splitWebsiteCell,groupWebsiteCells,referencedTableHeaders} from './website-table-grid.js';
import {inventoryWindow} from './website-inventory.js';
const protectedContent='[data-observanda-source],[data-observanda-part],[data-observanda-link],[data-observanda-editor],[data-website-feed],[data-website-instance]';
const tag=node=>node?.localName;
function blankCell(document,reference){
 const cell=document.createElement(tag(reference)==='th'?'th':'td');
 if(reference?.hasAttribute('scope'))cell.scope=reference.scope;
 return cell;
}
export function websiteTableTools({document,inspector,translate:t,beforeChange,changed,addCSS}){
 const host=inspector.ownerDocument,controller=new AbortController(),signal=controller.signal;
 const create=(name,text)=>{const node=host.createElement(name);if(text!==undefined)node.textContent=text;return node;};
 const tools=create('fieldset'),legend=create('legend',t('tableTools'));tools.hidden=true;tools.append(legend);inspector.append(tools);
 function field(key,tag='input'){
  const label=create('label',t(key)),control=create(tag);control.dataset.tableField=key;label.append(control);tools.append(label);return control;
 }
 const row=field('tableRow'),column=field('tableColumn'),value=field('tableCellText'),role=field('tableCellRole','select'),caption=field('tableCaption');
 row.type=column.type='number';row.min=column.min='1';row.step=column.step='1';
 for(const [key,id] of [['tableDataCell','data'],['tableColumnHeader','col'],['tableRowHeader','row'],['tableGroupRowHeader','rowgroup'],['tableGroupColumnHeader','colgroup'],['tableHeaderAuto','auto']]){
  const option=create('option',t(key));option.value=id;role.append(option);
 }
 const info=create('p');info.setAttribute('role','status');tools.append(info);
 function button(key,fn){
  const b=create('button',t(key));b.type='button';b.className='button';b.dataset.tableAction=key;tools.append(b);b.addEventListener('click',fn,{signal});return b;
 }
 let table=null,cell=null,cached=null;
 const observer=new MutationObserver(()=>{cached=null;});
 function grid(){
  if(observer.takeRecords().length)cached=null;
  return cached??=websiteTableGrid(table);
 }
 const roleOf=node=>tag(node)==='th'?(node.getAttribute('scope')||'auto'):'data';
 const editable=()=>table?.isConnected&&document.body.contains(table)&&!table.closest(protectedContent)&&!table.querySelector(protectedContent)&&cell?.closest('table')===table;
 function pick(r,c){
  if(!table)return null;
  const rows=table.rows,actual=rows[Math.min(Math.max(0,r),rows.length-1)];
  return actual?.cells[Math.min(Math.max(0,c),actual.cells.length-1)]??null;
 }
 function refresh(){
  tools.hidden=!editable();if(tools.hidden)return;
  const structure=grid(),parent=cell.parentElement,position=structure.cells?.get(cell);
  row.value=String((position?.top??parent.rowIndex)+1);row.max=String(table.rows.length);
  column.value=String((position?.left??cell.cellIndex)+1);column.max=String(structure.width??parent.cells.length);
  value.value=cell.textContent;value.disabled=cell.childElementCount!==0;
  role.value=roleOf(cell);role.disabled=!!structure.error;
  caption.value=table.caption?.textContent??'';caption.disabled=Boolean(table.caption?.childElementCount);
  for(const b of structural)b.disabled=!!structure.error;
  if(!structure.error){removeRow.disabled=structure.rows.length<2;removeColumn.disabled=structure.width<2;}
  if(position){height.value=String(position.bottom-position.top);width.value=String(position.right-position.left);}
  scroll.hidden=!addCSS;scroll.textContent=t(table.parentElement.matches('.website-table-scroll')?'tableScrollOff':'tableScrollOn');
  if(headers.open)drawHeaders();
  info.textContent=structure.error?t(structure.error):'';
 }
 function change(apply){
  if(!editable())return;
  beforeChange();apply();changed();refresh();
 }
 function switchAddress(){
  if(!editable()||!row.validity.valid||!Number.isInteger(row.valueAsNumber)||!Number.isInteger(column.valueAsNumber))return refresh();
  const shape=grid(),next=shape.error?table.rows[row.valueAsNumber-1]?.cells[column.valueAsNumber-1]:shape.at(row.valueAsNumber-1,column.valueAsNumber-1)?.cell;if(!next)return refresh();
  cell=next;refresh();
 }
 row.addEventListener('change',switchAddress,{signal});column.addEventListener('change',switchAddress,{signal});
 button('tableApply',()=>{
  if(!editable())return;
  const replaceText=!value.disabled&&value.value!==cell.textContent,newCaption=caption.value;
  const replaceCaption=!caption.disabled&&newCaption!==(table.caption?.textContent??'');
  const newRole=role.value,oldRole=roleOf(cell),shape=grid();
  const replaceRole=!shape.error&&newRole!==oldRole;
  if(replaceRole&&newRole==='data'&&referencedTableHeaders(table,[cell])){info.textContent=t('tableHeaderInUse');return;}
  if(replaceRole&&newRole==='colgroup'){
   const place=shape.cells.get(cell),band=shape.columns.find(x=>x.start<=place.left&&x.end>place.left);
   if(!band||!shape.columns.some(x=>x.group===band.group&&x.end>=place.right)){info.textContent=t('tableGroupBeforeScope');return;}
  }
  if(!replaceText&&!replaceCaption&&!replaceRole)return;
  change(()=>{
   if(replaceRole){
    const next=document.createElement(newRole==='data'?'td':'th');
    for(const a of cell.attributes)if(a.name!=='scope')next.setAttribute(a.name,a.value);
    if(newRole!=='data'&&newRole!=='auto')next.scope=newRole;while(cell.firstChild)next.append(cell.firstChild);cell.replaceWith(next);cell=next;
   }
   if(replaceText)cell.textContent=value.value;
   if(replaceCaption){if(newCaption)table.createCaption().textContent=newCaption;else table.deleteCaption();}
  });
 });
 function applyPlan(make){
  if(!editable())return;const g=grid(),plan=g.error?g:make(g,cell);
  if(plan.error){info.textContent=t(plan.error);return;}
  change(()=>{const [r,c]=plan.apply();cached=null;cell=grid().at?.(r,c)?.cell??pick(r,c);});
 }
 const axis=(a,action)=>()=>applyPlan((g,node)=>editWebsiteAxis(g,node,a,action));
 const structural=[
  button('tableRowBefore',axis('row','before')),button('tableRowAfter',axis('row','after')),
  button('tableColumnBefore',axis('column','before')),button('tableColumnAfter',axis('column','after'))
 ];
 const removeRow=button('tableDeleteRow',axis('row','remove')),removeColumn=button('tableDeleteColumn',axis('column','remove'));structural.push(removeRow,removeColumn);
 const advanced=create('details');advanced.append(create('summary',t('tableStructure')));tools.append(advanced);
 const height=field('tableRangeHeight'),width=field('tableRangeWidth');
 for(const node of [height,width]){node.type='number';node.min=node.step='1';advanced.append(node.parentElement);}
 const advancedAction=(name,fn)=>{const b=button(name,fn);advanced.append(b);structural.push(b);};
 advancedAction('tableMerge',()=>applyPlan((g,c)=>mergeWebsiteCells(g,c,height.valueAsNumber,width.valueAsNumber)));
 advancedAction('tableSplit',()=>applyPlan(splitWebsiteCell));
 for(const [key,axis,direction] of [['tableMoveRowUp','row',-1],['tableMoveRowDown','row',1],['tableMoveColLeft','column',-1],['tableMoveColRight','column',1]])
  advancedAction(key,()=>applyPlan((g,c)=>moveWebsiteAxis(g,c,axis,direction)));
 advancedAction('tableGroupRows',()=>applyPlan((g,c)=>groupWebsiteCells(g,c,'row',height.valueAsNumber)));
 advancedAction('tableGroupCols',()=>applyPlan((g,c)=>groupWebsiteCells(g,c,'column',width.valueAsNumber)));
 const headers=create('details');headers.append(create('summary',t('tableAssociations')));tools.append(headers);
 const search=field('tableFindHeader'),choice=field('tableChooseHeader','select');
 headers.append(search.parentElement,choice.parentElement);search.type='search';
 let headAt=0,heads;
 const prev=button('prevPage',()=>{headAt=heads.previous;drawHeaders();}),next=button('nextPage',()=>{headAt=heads.next;drawHeaders();});
 const attach=button('tableAssociate',()=>{
  const target=heads?.items[Number(choice.value)];if(!target||!editable())return;
  if(target.id&&document.querySelectorAll('#'+CSS.escape(target.id)).length!==1){info.textContent=t('tableNamedMerge');return;}
  change(()=>{if(!target.id)target.id='th-'+crypto.randomUUID();const ids=new Set((cell.getAttribute('headers')??'').split(/\s+/).filter(Boolean));ids.add(target.id);cell.setAttribute('headers',[...ids].join(' '));});
 });
 const assigned=create('div');headers.append(prev,next,attach,assigned);
 function drawHeaders(){
  const shape=grid();choice.replaceChildren();assigned.replaceChildren();
  if(shape.error){attach.disabled=true;return;}
  const idTokens=(cell.getAttribute('headers')??'').split(/\s+/).filter(Boolean),used=new Set(idTokens);
  function* candidates(){for(const node of shape.cells.keys())if(node!==cell&&tag(node)==='th'&&(!node.id||!used.has(node.id)))yield node;}
  const label=node=>(node.textContent.trim().slice(0,140)||node.id||t('tableHeaderAuto'))+' · '+(shape.cells.get(node).top+1)+','+(shape.cells.get(node).left+1);
  heads=inventoryWindow(candidates(),{offset:headAt,query:search.value,label});
  for(const [index,node] of heads.items.entries())choice.add(new Option(label(node),String(index)));
  attach.disabled=!heads.items.length;prev.hidden=next.hidden=!heads.previous&&heads.next===null&&heads.offset===0;
  prev.disabled=heads.previous===null;next.disabled=heads.next===null;
  for(const id of idTokens){
   const node=document.getElementById(id),name=node&&shape.cells.has(node)?label(node):id;
   const b=button('tableRemoveHeader',()=>change(()=>{const ids=idTokens.filter(s=>s!==id);if(ids.length)cell.setAttribute('headers',ids.join(' '));else cell.removeAttribute('headers');}));
   b.textContent=t('tableRemoveHeader')+' · '+name;assigned.append(b);
  }
 }
 headers.ontoggle=()=>{if(headers.open&&editable()){headAt=0;drawHeaders();}};
 search.oninput=()=>{headAt=0;drawHeaders();};
 const scroll=button('tableScrollOn',()=>change(()=>{
  const wrapper=table.parentElement;
  if(wrapper.matches('.website-table-scroll')&&wrapper.children.length===1){wrapper.replaceWith(table);return;}
  const panel=document.createElement('div');panel.className='website-table-scroll';panel.tabIndex=0;panel.setAttribute('role','region');panel.setAttribute('aria-label',table.caption?.textContent.trim()||t('tableViewport'));
  table.replaceWith(panel);panel.append(table);addCSS('.website-table-scroll{max-inline-size:100%;overflow-x:auto;min-inline-size:0}.website-table-scroll:focus-visible{outline:2px solid currentColor;outline-offset:-2px}');
 }));
 function select(node){
  const element=node?.nodeType===1?node:node?.parentElement,next=element?.closest('table');
  if(next===table&&(!next||element===next||tag(element)==='caption'||element.closest('td,th')===cell))return;
  if(table!==next){observer.disconnect();cached=null;if(next)observer.observe(next,{subtree:true,childList:true,attributes:true,attributeFilter:['id','span','rowspan','colspan','headers','scope']});}
  table=next;cell=element?.closest('td,th');if(cell?.closest('table')!==table)cell=null;
  cell??=pick(0,0);refresh();
 }
 function pasteGrid(event){
  const text=event.clipboardData?.getData('text/plain');if(!text?.includes('\t'))return;
  const selection=document.getSelection();if(!selection?.rangeCount)return;
  const range=selection.getRangeAt(0),element=node=>node.nodeType===1?node:node.parentElement;
  const first=element(range.startContainer).closest('td,th');if(!first||!first.isContentEditable)return;
  event.preventDefault();event.stopPropagation();select(first);
  if(!editable())return;
  const shape=grid();
  if(shape.error||element(range.endContainer).closest('td,th')!==first){info.textContent=t(shape.error||'tablePasteStart');return;}
  let rows;
  if(text.length>MAX_TABLE_TEXT){info.textContent=t('tablePasteSize');return;}
  try{rows=readDelimitedTable(text,{delimiter:'\t',header:false,minColumns:1,preserveEmptyRows:true}).rows;}
  catch{info.textContent=t('tablePasteMalformed');return;}
  const group=first.parentElement.parentElement,start=first.parentElement.sectionRowIndex,{top,left:column}=shape.cells.get(first);
  const width=Math.max(shape.width,column+rows[0].cells.length),end=start+rows.length;
  if(end>group.rows.length&&tag(group)!=='tbody'){info.textContent=t('tablePasteConflict');return;}
  // Check the whole target before mutating. Leave rich labels, totals and
  // other row groups intact, and never coerce scientific values to numbers.
  const grow=width>shape.width||end>group.rows.length;
  if(grow&&(shape.columns.length||[...shape.cells.values()].some(p=>p.right-p.left>1||p.bottom-p.top>1))){info.textContent=t('tablePasteExtend');return;}
  for(let r=0;r<Math.min(group.rows.length-start,rows.length);r++){
   for(let c=column;c<Math.min(shape.width,column+rows[r].cells.length);c++){
    const target=shape.at(top+r,c);
    if(target.bottom-target.top>1||target.right-target.left>1){info.textContent=t('tableSplitFirst');return;}
    if([...target.cell.children].some(child=>tag(child)!=='br')){info.textContent=t('tablePasteConflict');return;}
   }
  }
  if(width*(shape.rows.length+Math.max(0,end-group.rows.length))*9>MAX_TABLE_TEXT){info.textContent=t('tablePasteSize');return;}
  change(()=>{
   if(width>shape.width)for(const existing of shape.rows){
    const ref=existing.cells[shape.width-1],newCells=document.createDocumentFragment();
    for(let c=shape.width;c<width;c++)newCells.append(blankCell(document,ref.scope==='row'?null:ref));
    existing.append(newCells);
   }
   if(end>group.rows.length){
    const model=[...first.parentElement.cells],newRows=document.createDocumentFragment();
    for(let r=group.rows.length;r<end;r++){const row=document.createElement('tr');for(const ref of model)row.append(blankCell(document,ref));newRows.append(row);}
    group.append(newRows);
   }
   const result=grow?websiteTableGrid(table):shape;
   for(const [r,row] of rows.entries())for(const [c,value] of row.cells.entries()){cell=result.at(top+r,column+c).cell;cell.textContent=value;}
   const caret=document.createRange();caret.selectNodeContents(cell);caret.collapse(false);selection.removeAllRanges();selection.addRange(caret);
  });
 }
 document.addEventListener('paste',pasteGrid,{capture:true,signal});
 return {select,destroy(){controller.abort();observer.disconnect();tools.remove();table=cell=null;}};
}
