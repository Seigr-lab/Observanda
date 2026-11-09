// Intervals represent a spanning cell once per affected row, never once per
// covered column. The cell's original DOM node retains rich text and identity.
export function websiteTableGrid(table){
 const rows=[...table.rows],lines=[],cells=new Map(),columns=[];
 let width=0,active=[],group;
 for(let y=0;y<rows.length;y++){
  const row=rows[y],owner=row.parentElement;
  if(owner!==group){group=owner;active=[];}
  else active=active.filter(item=>item.bottom>y);
  const placed=[];let x=0,i=0;
  for(const cell of row.cells){
   while(i<active.length&&active[i].left<=x){x=active[i].right;i++;}
   const right=x+cell.colSpan,remaining=owner.rows.length-row.sectionRowIndex;
   const height=cell.rowSpan===0?remaining:cell.rowSpan;
   if(height>remaining||i<active.length&&active[i].left<right)return {error:'tableOverlappingGrid'};
   const item={cell,group:owner,top:y,bottom:y+height,left:x,right};
   placed.push(item);cells.set(cell,item);x=right;
  }
  const line=[...active,...placed].sort((a,b)=>a.left-b.left);
  let end=0;for(const item of line){if(item.left!==end)return {error:'tableRaggedGrid'};end=item.right;}
  if(!y)width=end;
  if(end!==width||!end)return {error:'tableRaggedGrid'};
  lines.push(line);active=line.filter(item=>item.bottom>y+1);
 }
 for(const group of table.querySelectorAll(':scope > colgroup')){
  const children=[...group.children].filter(node=>node.localName==='col'),parts=children.length?children:[group];
  for(const part of parts){
   const start=columns.at(-1)?.end??0;
   columns.push({group,node:part,start,end:start+part.span});
  }
 }
 if(!width||columns.length&&columns.at(-1).end>width)return {error:'tableRaggedGrid'};
 function at(y,x){return lines[y]?.find(item=>item.left<=x&&item.right>x);}
 return {table,rows,lines,cells,width,columns,at};
}

function blank(reference){
 const cell=reference.ownerDocument.createElement(reference.localName);
 for(const attr of ['scope','headers'])if(reference.hasAttribute(attr))cell.setAttribute(attr,reference.getAttribute(attr));
 return cell;
}
function span(node,key,size){
 const attr=key==='rowSpan'?'rowspan':key==='colSpan'?'colspan':'span';
 if(size===1)node.removeAttribute(attr);else node[key]=size;
}
function insertAt(grid,row,x,node){
 const next=[...row.cells].find(cell=>(grid.cells.get(cell)?.left??-1)>=x);
 row.insertBefore(node,next??null);
}
function gridAction(apply){return {apply};}
export function referencedTableHeaders(table,cells){
 const ids=new Set(cells.map(cell=>cell.id).filter(Boolean));if(!ids.size)return false;
 return [...table.ownerDocument.querySelectorAll('[headers],[aria-labelledby],[aria-describedby]')].some(node=>
  ['headers','aria-labelledby','aria-describedby'].some(key=>node.getAttribute(key)?.split(/\s+/).some(id=>ids.has(id))));
}

export function editWebsiteAxis(g,cell,axis,action){
 const item=g.cells.get(cell),isRow=axis==='row';
 const pos=isRow?item.top:item.left,end=isRow?item.bottom:item.right;
 const max=isRow?g.rows.length:g.width,at=action==='after'?end:pos;
 const remove=action==='remove',doc=cell.ownerDocument;
 if(remove&&max<2)return {error:'tableKeepCell'};
 if(isRow){
  const current=g.rows[pos],group=item.group,groupStart=pos-current.sectionRowIndex,groupEnd=groupStart+group.rows.length;
  if(remove){
   if(group.rows.length===1&&g.rows.length>1&&group.id)return {error:'tableNamedGroup'};
   const gone=g.lines[pos].filter(x=>x.top===pos&&x.bottom===pos+1);
   if(referencedTableHeaders(g.table,gone.map(x=>x.cell)))return {error:'tableHeaderInUse'};
   return gridAction(()=>{
    for(const x of g.lines[pos]){
     if(x.top===pos&&x.bottom>pos+1)insertAt(g,g.rows[pos+1],x.left,x.cell);
     if(x.bottom-x.top>1&&x.cell.rowSpan!==0)span(x.cell,'rowSpan',x.bottom-x.top-1);
    }
    current.remove();if(!group.rows.length)group.remove();
    return [Math.min(pos,g.rows.length-2),item.left];
   });
  }
  const through=at>groupStart&&at<groupEnd?g.lines[at].filter(x=>x.top<at):[];
  // A rowspan of zero also covers a new last row of its own group.
  if(at===groupEnd)through.push(...g.lines[at-1].filter(x=>x.cell.rowSpan===0));
  if(through.some(x=>x.cell.rowSpan===65534))return {error:'tableSpanLimit'};
  const row=doc.createElement('tr'),sample=g.lines[at===groupStart?at:at-1];let x=0,k=0,j=0;
  while(x<g.width){
   if(k<through.length&&through[k].left===x){x=through[k++].right;continue;}
   while(sample[j].right<=x)j++;
   const ref=sample[j],next=blank(ref.cell),right=Math.min(ref.right,through[k]?.left??g.width);
   span(next,'colSpan',right-x);row.append(next);x=right;
  }
  return gridAction(()=>{
   for(const x of through)if(x.cell.rowSpan!==0)span(x.cell,'rowSpan',x.bottom-x.top+1);
   group.insertBefore(row,at===groupEnd?null:g.rows[at]);return [at,item.left];
  });
 }
 const band=g.columns.find(col=>col.start<=Math.min(at,g.width-1)&&Math.min(at,g.width-1)<col.end);
 if(remove){
  const affected=new Set(g.lines.map((_,y)=>g.at(y,pos)));
  if(referencedTableHeaders(g.table,[...affected].filter(x=>x.right-x.left===1).map(x=>x.cell)))return {error:'tableHeaderInUse'};
  return gridAction(()=>{
   for(const x of affected){if(x.right-x.left===1)x.cell.remove();else span(x.cell,'colSpan',x.right-x.left-1);}
   if(band){
    if(band.node.span>1)span(band.node,'span',band.node.span-1);
    else{band.node.remove();if(band.node!==band.group&&!band.group.children.length)band.group.remove();}
   }
   return [item.top,Math.min(pos,g.width-2)];
  });
 }
 const across=new Set(),added=[];
 for(let y=0;y<g.rows.length;y++){
  const reference=g.at(y,Math.min(at,g.width-1));
  if(reference.left<at&&reference.right>at){across.add(reference);continue;}
  const cell=blank(reference.cell);
  // Blank cells need their own column headers. Copying explicit associations
  // from the adjacent column would silently describe different measurements.
  if(cell.hasAttribute('headers'))cell.removeAttribute('headers');
  added.push([g.rows[y],cell]);
 }
 if([...across].some(x=>x.cell.colSpan===1000)||band?.node.span===1000)return {error:'tableSpanLimit'};
 return gridAction(()=>{
  for(const x of across)span(x.cell,'colSpan',x.right-x.left+1);
  for(const [row,node] of added)insertAt(g,row,at,node);
  if(band)span(band.node,'span',band.node.span+1);
  return [item.top,at];
 });
}

export function mergeWebsiteCells(g,origin,h,w){
 const start=g.cells.get(origin),{top,left}=start,bottom=top+h,right=left+w;
 if(!Number.isSafeInteger(h)||!Number.isSafeInteger(w)||h<1||w<1||bottom>g.rows.length||right>g.width)return {error:'tableRangeInvalid'};
 if(h>65534||w>1000)return {error:'tableSpanLimit'};
 const members=new Set();
 for(let y=top;y<bottom;y++){
  if(g.rows[y].parentElement!==start.group)return {error:'tableGroupBoundary'};
  for(const item of g.lines[y])if(item.left<right&&item.right>left){
   if(item.left<left||item.right>right||item.top<top||item.bottom>bottom)return {error:'tableSplitFirst'};
   members.add(item);
  }
 }
 if(members.size<2)return {error:'tableRangeInvalid'};
 const rest=[...members].filter(x=>x!==start);
 if(rest.some(x=>x.cell.localName!==origin.localName||(x.cell.getAttribute('scope')??'')!==(origin.getAttribute('scope')??'')))return {error:'tableMixedRoles'};
 if(rest.some(x=>[...x.cell.attributes].some(a=>!['scope','headers','rowspan','colspan','id'].includes(a.name))))return {error:'tableCellAttributes'};
 const ids=new Set(rest.filter(x=>x.cell.id).map(x=>x.cell.id));
 if([...ids,origin.id].filter(Boolean).some(id=>origin.ownerDocument.querySelectorAll('#'+CSS.escape(id)).length!==1))return {error:'tableNamedMerge'};
 const associations=[...g.table.querySelectorAll('th[headers],td[headers]')].filter(node=>node.closest('table')===g.table&&node.getAttribute('headers').split(/\s+/).some(id=>ids.has(id)));
 return gridAction(()=>{
  if(associations.length){
   if(!origin.id)origin.id='th-'+crypto.randomUUID();
   for(const node of associations){const tokens=node.getAttribute('headers').split(/\s+/).filter(Boolean).map(id=>ids.has(id)?origin.id:id);
    node.setAttribute('headers',[...new Set(tokens)].join(' '));}
  }
  const headers=new Set();
  for(const {cell} of members)for(const id of (cell.getAttribute('headers')??'').split(/\s+/))if(id)headers.add(id);
  if(headers.size)origin.setAttribute('headers',[...headers].join(' '));
  for(const {cell} of rest){
   if(origin.childNodes.length&&cell.childNodes.length)origin.append(origin.ownerDocument.createElement('br'));
   let destination=origin;
   if(cell.id){destination=origin.ownerDocument.createElement('span');destination.id=cell.id;origin.append(destination);}
   while(cell.firstChild)destination.append(cell.firstChild);cell.remove();
  }
  span(origin,'rowSpan',h);span(origin,'colSpan',w);return [top,left];
 });
}

// Reordering a boundary crossed by a merged cell changes what the cell
// describes. Keep that operation explicit through split or group selection.
export function moveWebsiteAxis(g,cell,axis,direction){
 const item=g.cells.get(cell),rowAxis=axis==='row',at=rowAxis?item.top:item.left,to=at+direction;
 const size=rowAxis?g.rows.length:g.width;
 if(to<0||to>=size)return {error:'tableRangeInvalid'};
 if(rowAxis){
  const row=g.rows[at],other=g.rows[to];if(row.parentElement!==other.parentElement)return {error:'tableGroupBoundary'};
  if([...g.lines[at],...g.lines[to]].some(x=>x.bottom-x.top>1))return {error:'tableSplitFirst'};
  return gridAction(()=>{if(direction<0)other.before(row);else other.after(row);return [to,item.left];});
 }
 const here=g.columns.find(c=>c.start<=at&&at<c.end),there=g.columns.find(c=>c.start<=to&&to<c.end);
 if(here?.group!==there?.group)return {error:'tableGroupBoundary'};
 if(here!==there&&(here?.node.span!==1||there?.node.span!==1))return {error:'tableColumnBand'};
 const swaps=[];
 for(const [y] of g.rows.entries()){
  const a=g.at(y,at),b=g.at(y,to);
  if(a.right-a.left!==1||b.right-b.left!==1||a.top!==b.top||a.bottom!==b.bottom)return {error:'tableSplitFirst'};
  if(a.top===y)swaps.push([a.cell,b.cell]);
 }
 return gridAction(()=>{
  if(here!==there){if(direction<0)there.node.before(here.node);else there.node.after(here.node);}
  for(const [a,b] of swaps){if(direction<0)b.before(a);else b.after(a);}
  return [item.top,to];
 });
}

export function splitWebsiteCell(g,cell){
 const {top,bottom,left,right}=g.cells.get(cell);
 if(bottom-top===1&&right-left===1)return {error:'tableSelectSpan'};
 return gridAction(()=>{
  for(let y=top;y<bottom;y++){
   const row=g.rows[y],before=[...row.cells].find(node=>g.cells.get(node).left>=right)??null;
   const fragment=cell.ownerDocument.createDocumentFragment();
   for(let x=y===top?left+1:left;x<right;x++)fragment.append(blank(cell));
   row.insertBefore(fragment,before);
  }
  span(cell,'rowSpan',1);span(cell,'colSpan',1);return [top,left];
 });
}

export function groupWebsiteCells(g,cell,axis,size){
 const {top,left,group}=g.cells.get(cell),document=cell.ownerDocument;
 if(!Number.isInteger(size)||size<1)return {error:'tableRangeInvalid'};
 if(axis==='row'){
  const first=cell.parentElement.sectionRowIndex,after=first+size,rows=[...group.rows];
  if(group.localName!=='tbody'||after>rows.length)return {error:'tableGroupBoundary'};
  if(!first&&after===rows.length)return {error:'tableAlreadyGrouped'};
  const boundary=y=>y<g.rows.length&&g.lines[y].some(x=>x.top<y);
  if(boundary(top)||boundary(top+size))return {error:'tableSplitFirst'};
  if(group.id||group.querySelector('th[scope="rowgroup"]'))return {error:'tableNamedGroup'};
  return gridAction(()=>{
   let parent=group;
   for(const [i,row] of rows.entries()){
    if(i&&(i===first||i===after)){const added=group.cloneNode(false);parent.after(added);parent=added;}
    if(row.parentElement!==parent)parent.append(row);
   }return [top,left];
  });
 }
 const end=left+size;if(end>g.width)return {error:'tableRangeInvalid'};
 const groups=[...g.table.querySelectorAll(':scope > colgroup')];
 if(groups.some(n=>n.children.length||[...n.attributes].some(a=>a.name!=='span'))||g.table.querySelector('th[scope="colgroup"]'))return {error:'tableColumnBand'};
 const parts=g.columns.map(col=>[col.start,col.end]),last=parts.at(-1)?.[1]??0;
 if(last<g.width)parts.push([last,g.width]);
 if(groups.length&&parts.some(([a,b])=>a===left&&b===end))return {error:'tableAlreadyGrouped'};
 const widths=[];
 for(const [a,b] of parts)if(a<left)widths.push(Math.min(left,b)-a);
 widths.push(size);
 for(const [a,b] of parts)if(b>end)widths.push(b-Math.max(end,a));
 if(widths.some(w=>w>1000))return {error:'tableSpanLimit'};
 return gridAction(()=>{
  const before=groups[0]??[...g.table.children].find(node=>node.localName!=='caption');
  for(const width of widths){const node=document.createElement('colgroup');span(node,'span',width);g.table.insertBefore(node,before??null);}
  groups.forEach(group=>group.remove());return [top,left];
 });
}
