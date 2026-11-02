// These controls edit the authored HTML table in the canvas. Converted
// records and linked content remain under their own publication permissions.
const protectedContent='[data-observanda-source],[data-observanda-part],[data-observanda-link],[data-observanda-editor]';
const tag=node=>node?.localName;
function grid(table){
 const rows=Array.from(table.rows),width=rows[0]?.cells.length;
 if(!width||table.querySelector('colgroup,col,table,[headers],[scope="rowgroup"],[scope="colgroup"]'))return null;
 if(rows.some(row=>row.cells.length!==width||Array.from(row.cells).some(cell=>cell.colSpan!==1||cell.rowSpan!==1)))return null;
 return {rows,width};
}
function blankCell(document,reference){
 const cell=document.createElement(tag(reference)==='th'?'th':'td');
 if(reference?.hasAttribute('scope'))cell.scope=reference.scope;
 return cell;
}
export function websiteTableTools({document,inspector,translate:t,beforeChange,changed}){
 const host=inspector.ownerDocument,controller=new AbortController(),signal=controller.signal;
 const create=(name,text)=>{const node=host.createElement(name);if(text!==undefined)node.textContent=text;return node;};
 const tools=create('fieldset'),legend=create('legend',t('tableTools'));tools.hidden=true;tools.append(legend);inspector.append(tools);
 function field(key,tag='input'){
  const label=create('label',t(key)),control=create(tag);control.dataset.tableField=key;label.append(control);tools.append(label);return control;
 }
 const row=field('tableRow'),column=field('tableColumn'),value=field('tableCellText'),role=field('tableCellRole','select'),caption=field('tableCaption');
 row.type=column.type='number';row.min=column.min='1';row.step=column.step='1';
 for(const [key,id] of [['tableDataCell','data'],['tableColumnHeader','col'],['tableRowHeader','row']]){
  const option=create('option',t(key));option.value=id;role.append(option);
 }
 const info=create('p');info.setAttribute('role','status');tools.append(info);
 function button(key,fn){
  const b=create('button',t(key));b.type='button';b.className='button';b.dataset.tableAction=key;tools.append(b);b.addEventListener('click',fn,{signal});return b;
 }
 let table=null,cell=null;
 const editable=()=>table?.isConnected&&document.body.contains(table)&&!table.closest(protectedContent)&&!table.querySelector(protectedContent)&&cell?.closest('table')===table;
 function pick(r,c){
  if(!table)return null;
  const rows=table.rows,actual=rows[Math.min(Math.max(0,r),rows.length-1)];
  return actual?.cells[Math.min(Math.max(0,c),actual.cells.length-1)]??null;
 }
 function refresh(){
  tools.hidden=!editable();if(tools.hidden)return;
  const structure=grid(table),parent=cell.parentElement;
  row.value=String(parent.rowIndex+1);row.max=String(table.rows.length);
  column.value=String(cell.cellIndex+1);column.max=String(parent.cells.length);
  value.value=cell.textContent;value.disabled=cell.childElementCount!==0;
  role.value=tag(cell)==='th'?(cell.scope==='row'?'row':'col'):'data';
  role.disabled=!structure;
  caption.value=table.caption?.textContent??'';caption.disabled=Boolean(table.caption?.childElementCount);
  for(const b of structural)b.disabled=!structure;
  if(structure){removeRow.disabled=structure.rows.length<2;removeColumn.disabled=structure.width<2;}
  info.textContent=structure?'':t('tableComplex');
 }
 function change(apply){
  if(!editable())return;
  beforeChange();apply();changed();refresh();
 }
 function switchAddress(){
  if(!editable()||!row.validity.valid||!Number.isInteger(row.valueAsNumber)||!Number.isInteger(column.valueAsNumber))return refresh();
  const r=table.rows[row.valueAsNumber-1],next=r?.cells[column.valueAsNumber-1];if(!next)return refresh();
  cell=next;refresh();
 }
 row.addEventListener('change',switchAddress,{signal});column.addEventListener('change',switchAddress,{signal});
 button('tableApply',()=>{
  if(!editable())return;
  const replaceText=!value.disabled&&value.value!==cell.textContent,newCaption=caption.value;
  const replaceCaption=!caption.disabled&&newCaption!==(table.caption?.textContent??'');
  const newRole=role.value,oldRole=tag(cell)==='th'?(cell.scope==='row'?'row':'col'):'data';
  const replaceRole=Boolean(grid(table))&&newRole!==oldRole;
  if(!replaceText&&!replaceCaption&&!replaceRole)return;
  change(()=>{
   if(replaceRole){
    const next=document.createElement(newRole==='data'?'td':'th');
    for(const a of cell.attributes)if(a.name!=='scope')next.setAttribute(a.name,a.value);
    if(newRole!=='data')next.scope=newRole;while(cell.firstChild)next.append(cell.firstChild);cell.replaceWith(next);cell=next;
   }
   if(replaceText)cell.textContent=value.value;
   if(replaceCaption){if(newCaption)table.createCaption().textContent=newCaption;else table.deleteCaption();}
  });
 });
 function rowAction(action){
  if(!editable())return;const s=grid(table),current=cell.parentElement,r=current.rowIndex,c=cell.cellIndex;
  if(!s||action==='remove'&&s.rows.length===1)return;
  change(()=>{
   if(action==='remove'){current.remove();cell=pick(r,c);return;}
   const next=document.createElement('tr');
   for(const source of current.cells)next.append(blankCell(document,source));
   if(action==='before')current.before(next);else current.after(next);cell=next.cells[c];
  });
 }
 function columnAction(action){
  if(!editable())return;const s=grid(table),c=cell.cellIndex,r=cell.parentElement.rowIndex;
  if(!s||action==='remove'&&s.width===1)return;
  change(()=>{
   for(const current of s.rows){
    const anchor=current.cells[c];if(action==='remove')anchor.remove();
    else if(action==='before')anchor.before(blankCell(document,anchor));else anchor.after(blankCell(document,anchor));
   }
   cell=pick(r,action==='after'?c+1:c);
  });
 }
 const structural=[
  button('tableRowBefore',()=>rowAction('before')),button('tableRowAfter',()=>rowAction('after')),
  button('tableColumnBefore',()=>columnAction('before')),button('tableColumnAfter',()=>columnAction('after'))
 ];
 const removeRow=button('tableDeleteRow',()=>rowAction('remove')),removeColumn=button('tableDeleteColumn',()=>columnAction('remove'));structural.push(removeRow,removeColumn);
 function select(node){
  const element=node?.nodeType===1?node:node?.parentElement,next=element?.closest('table');
  if(next===table&&(!next||element===next||tag(element)==='caption'||element.closest('td,th')===cell))return;
  table=next;cell=element?.closest('td,th');if(cell?.closest('table')!==table)cell=null;
  cell??=pick(0,0);refresh();
 }
 return {select,destroy(){controller.abort();tools.remove();table=cell=null;}};
}
