import {sharedFigureControls,mountSharedFigures} from './shared-figure-reader.js';
import {isRetainedFigure} from './retained-figure-model.js';
import {t} from './i18n/index.js';
import {recordRevisionView} from './record-revision-view.js';
import {applyRichTextStyles} from './rich-text-stylesheet.js';
import {materialFileSummary} from './material-file-summary.js';
import {figureReadingView} from './figure-reading-view.js';
import {renderFigureView,figureTable} from './figure-renderer.js';
import {bookText} from './book-messages.js';
const tr=(key,values)=>t('online',key,values);

// Read retained facts through their original reference chain. Every page and
// download is authorized again by the host; browsing never changes a dataset.
export function onlineRetainedReference({host,recordId,rootRef,remote,esc,fileUrl,figureURL,onBusy,operations={read:'attempt-read',page:'attempt-page'}}){
 let disposed=false,busy=false,blocked=false,trail=[],rowsCursor={page:0,rowOffset:0},previous=[],columnOffset=0,rows=null,figures=null;
 const button=(key,attrs='')=>'<button type="button" class="button" '+attrs+'>'+esc(tr(key))+'</button>';
 const request=(operation,data={})=>remote(operation,{recordId,ref:rootRef,trail,...data});
 const manifest=(value,key='retainedMetadata')=>'<details><summary>'+esc(tr(key))+'</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details>';
 function controls(){host.setAttribute('aria-busy',String(busy));for(const el of host.querySelectorAll('button'))el.disabled=busy||blocked||el.dataset.unavailable==='true';}
 async function run(work){if(busy||blocked||disposed)return;busy=true;controls();onBusy(true);try{await work();}catch(error){if(!disposed)host.querySelector('[data-reference-status]').textContent=error.message;}finally{busy=false;if(!disposed){onBusy(false);controls();}}}
 async function loadRows(){
  const result=await request(operations.page,{slot:'rows',...rowsCursor,columnOffset});if(disposed)return;rows=result;
  const action=(key,name,unavailable)=>button(key,'data-table-action="'+name+'" data-unavailable="'+unavailable+'"');
  host.querySelector('[data-reference-rows]').innerHTML='<p>'+esc(tr('retainedRows',{count:result.rowCount}))+'</p><div class="table-scroll" tabindex="0" role="region" aria-label="'+esc(tr('retainedValues'))+'"><table><thead><tr><th>'+esc(tr('retainedRow'))+'</th>'+result.columns.map(c=>'<th>'+esc(c.name)+'<small>'+esc(c.representation)+(c.representation==='radix'||c.representation==='radix-fraction'?' · '+esc(tr('retainedBase',{base:c.radix})):'')+' · '+esc(c.unit)+'</small></th>').join('')+'<th>'+esc(tr('retainedExclusion'))+'</th></tr></thead><tbody>'+result.rows.map(row=>'<tr><th scope="row"><details><summary>'+esc(row.order??row.line)+'</summary><code>'+esc(row.id)+'</code>'+manifest(row.locator??{},'retainedSourcePositions')+'</details></th>'+row.cells.map((value,i)=>'<td>'+esc(['null','absent'].includes(row.valueKinds?.[i])?tr('retained_'+row.valueKinds[i]):value===''?tr('retainedEmpty'):value)+'</td>').join('')+'<td>'+esc(row.excluded??'')+'</td></tr>').join('')+'</tbody></table></div><div class="module-actions">'+action('retainedPreviousRows','previous',!previous.length)+action('retainedNextRows','next',!rows.next)+'</div><div class="module-actions">'+action('retainedPreviousColumns','columns-previous',columnOffset===0)+'<span>'+esc(tr('retainedColumns',{first:columnOffset+1,last:columnOffset+result.columns.length,total:result.columnCount}))+'</span>'+action('retainedNextColumns','columns-next',columnOffset+result.columns.length>=result.columnCount)+'</div>'+manifest(result.columns,'retainedSchema');
  controls();
 }
 async function loadReferences(slot,offset=0){
  const result=await request(operations.page,{slot,offset});if(disposed)return;
  host.querySelector('[data-reference-slot="'+slot+'"]').innerHTML='<h5>'+esc(t('materialAnalysis',slot))+'</h5><ul>'+result.items.map((ref,i)=>'<li>'+(ref.withheld?esc(tr('retainedWithheld')):'<button type="button" class="text-button" data-reference-hop="'+slot+'" data-index="'+(offset+i)+'" data-unavailable="'+(trail.length>=16)+'">'+esc(ref.title)+'</button><p>'+esc(tr('attemptKind_'+ref.kind))+' · <code>'+esc(ref.revision)+'</code></p>')+'</li>').join('')+'</ul><div class="module-actions">'+button('retainedPreviousReferences','data-reference-page="'+slot+'" data-offset="'+Math.max(0,offset-20)+'" data-unavailable="'+(offset===0)+'"')+button('retainedNextReferences','data-reference-page="'+slot+'" data-offset="'+(result.next??0)+'" data-unavailable="'+(result.next===null)+'"')+'</div>'+(trail.length>=16?'<p>'+esc(tr('retainedDepth'))+'</p>':'');
  controls();
 }
 async function open(nextTrail=[]){
  figures?.dispose();figures=null;trail=nextTrail;host.innerHTML='<p role="status" data-reference-status>'+esc(tr('busy'))+'</p>';
  const result=await request(operations.read);if(disposed)return;
  host.innerHTML='<p role="status" data-reference-status></p>'+(trail.length?button('retainedBack','data-reference-back'):'')+'<h4>'+esc(result.record?.title??result.document.title)+'</h4><code>'+esc(result.revision)+'</code><div data-reference-content></div>';
  const body=host.querySelector('[data-reference-content]'),url=(kind,id)=>fileUrl(kind,id,rootRef,trail),figureSelector={recordId,revision:result.revision,via:{kind:operations.read.startsWith('evidence')?'evidence':'attempt',ref:structuredClone(rootRef),trail:structuredClone(trail)}},mountFigures=()=>{figures=mountSharedFigures(body,{selector:figureSelector,request:data=>remote('figure',data),downloadURL:figureURL});};
  if(result.record){body.innerHTML=recordRevisionView(result.record,esc,{figureSources:false,retainedFigureAction:sharedFigureControls(esc),assetUrl:id=>url('media',id)});mountFigures();applyRichTextStyles(document,result.record);return;}
  const doc=result.document,c=doc.content;
  body.innerHTML='<p>'+esc(tr('attemptKind_'+doc.kind))+' · '+esc(doc.createdAt)+'</p>'+(doc.kind==='artifact'?materialFileSummary({...result.reference,file:c},{esc,downloadUrl:url('artifact',doc.id)})+(c.provenance?'<p class="online-comment">'+esc(c.provenance)+'</p>':''):'')+(c.tool?'<dl><dt>'+esc(t('materialAnalysis','tool'))+'</dt><dd>'+esc(c.tool)+'</dd><dt>'+esc(t('materialAnalysis','version'))+'</dt><dd>'+esc(c.version)+'</dd><dt>'+esc(t('materialAnalysis','procedure'))+'</dt><dd class="online-comment">'+esc(c.parameters)+'</dd></dl>':'')+(c.figure?'<div class="material-figure" data-reference-figure></div>':'')+(doc.kind==='dataset'?'<div data-reference-rows></div>':'')+'<div data-reference-slot="inputs"></div><div data-reference-slot="outputs"></div>'+manifest(doc);
  controls();if(isRetainedFigure(c.figure)){body.querySelector('[data-reference-figure]').innerHTML=sharedFigureControls(esc)(c.figure);mountFigures();}else if(c.figure)body.querySelector('[data-reference-figure]').innerHTML=figureReadingView(renderFigureView(c.figure,{idPrefix:'shared-retained-'+crypto.randomUUID()}),c.figure.title)+'<details><summary>'+esc(bookText('tableReading'))+'</summary>'+figureTable(c.figure)+'</details>';
  if(doc.kind==='dataset'){rowsCursor={page:0,rowOffset:0};previous=[];columnOffset=0;await loadRows();}
  for(const slot of ['inputs','outputs'])if((c[slot]?.length??c[slot+'Index']?.count??0)>0)await loadReferences(slot);
 }
 const click=e=>{const el=e.target.closest('[data-reference-back],[data-reference-hop],[data-reference-page],[data-table-action]');if(!el)return;e.preventDefault();e.stopPropagation();void run(async()=>{
  if(el.hasAttribute('data-reference-back'))return open(trail.slice(0,-1));
  if(el.dataset.referenceHop)return open([...trail,{slot:el.dataset.referenceHop,index:Number(el.dataset.index)}]);
  if(el.dataset.referencePage)return loadReferences(el.dataset.referencePage,Number(el.dataset.offset));
  const action=el.dataset.tableAction,prior={rowsCursor,previous:[...previous],columnOffset};
  if(action==='next'){previous.push(rowsCursor);rowsCursor=rows.next;}else if(action==='previous')rowsCursor=previous.pop();else{columnOffset+=action==='columns-next'?16:-16;rowsCursor={page:0,rowOffset:0};previous=[];}
  try{await loadRows();}catch(error){({rowsCursor,previous,columnOffset}=prior);throw error;}
 });};host.addEventListener('click',click);
 return {open:()=>run(()=>open()),setBlocked(value){blocked=value;controls();},dispose(){disposed=true;figures?.dispose();host.removeEventListener('click',click);}};
}
