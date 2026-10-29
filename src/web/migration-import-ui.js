import {t} from './i18n/index.js';
import {RECORD_TYPES} from './record-types.js';
import {recordTypeLabel} from './record-type-presentation.js';
import {REPRESENTATIONS} from './measurement-model.js';
import {measurementText as mt} from './measurement-schema-ui.js';
import {renderProse} from './prose-model.js';
import {bookSourceMap} from './book-source-map.js';
import {importEvidenceRepairUI} from './import-evidence-repair-ui.js';
import {importResearchMapping,importResearchPreview} from './import-research-ui.js';

export function migrationImportUI({state,api,esc,field,render,showDialog}){
 const tr=(key,values)=>t('migrationImport',key,values),text=(key,values)=>esc(tr(key,values));
 let context=null,request=null,batch=null,result=null,detail=null,list=null,listAfter=null,offset=0,error='',errorTargets=[],open=false,creation=null;
 const button=(key,action,extra='')=>'<button type="button" class="button" data-action="migration-import-'+action+'" '+(request?'disabled ':'')+extra+'>'+text(key)+'</button>';
 const command=extra=>({workspaceId:state.book.id,...(batch?{id:batch.id}:{}),...extra});
 const evidence=importEvidenceRepairUI({state,call,esc,button});
 function bind(){
  if(context!==state.storage?.contextId||state.access?.locked){request?.abort();request=null;batch=result=detail=list=creation=null;evidence.reset();open=false;error='';errorTargets=[];context=state.storage?.contextId;}
  if(state.page!=='migration'&&request){request.abort();request=null;}
 }
 async function call(operation,data={},signal){return api('/api/migration/import/'+operation,command(data),{signal,adopt:false,onProgress:p=>{
  const el=document.getElementById('migration-import-progress');if(el)el.textContent=p.phase==='staging'?tr('stagingFile',{path:p.path,bytes:p.bytesRead,total:p.totalBytes}):tr('working');
 }});}
 async function busy(operation){
  if(request)return;const controller=new AbortController(),expected=context;request=controller;error='';errorTargets=[];render();
  try{await operation(controller.signal);}
  catch(e){if(expected===context){error=controller.signal.aborted?tr('paused'):e.message??tr('failed');errorTargets=[...new Set((Array.isArray(e.details)?e.details:[]).flatMap(d=>d.indexes??[d.index]).filter(i=>Number.isInteger(i)&&i>=0&&i<batch?.count))];}}
  finally{if(request===controller){request=null;render();}}
 }
 async function page(signal){result=await call('page',{offset},signal);batch=result.batch;detail=null;}
 async function runSteps(signal){
  while(['staging','reviewing'].includes(batch.state)){
   signal.throwIfAborted();batch=await call(batch.state==='staging'?'stage':'review',{},signal);
   const el=document.getElementById('migration-import-progress');if(el)el.textContent=batch.state==='staging'?tr('staged',{count:batch.staged,total:batch.counts.files}):tr('prepared',{count:batch.prepared,total:batch.count});
  }
  await page(signal);
 }
 const options=(values,selected)=>values.map(([value,label])=>'<option value="'+esc(value)+'" '+(String(selected)===String(value)?'selected':'')+'>'+esc(label)+'</option>').join('');
 const notebookOptions=selected=>options(state.book.notebooks.map(n=>[n.id,(state.book.projects.find(p=>p.id===n.projectId)?.title??'')+' / '+n.title]),selected);
 const select=(name,label,values,selected)=>field(tr(label),'<select name="'+name+'">'+options(values,selected)+'</select>');
 function datasetField(i,f={name:'',path:''},c={representation:'text',radix:10,unit:''}){
  return '<fieldset data-import-column="'+i+'"><legend>'+text('datasetColumn',{number:i+1})+'</legend>'+
   field(tr('columnName'),'<input name="column-name-'+i+'" maxlength="200" value="'+esc(f.name)+'">')+
   field(tr('columnPath'),'<input name="column-path-'+i+'" maxlength="2048" value="'+esc(f.path)+'">')+
   select('column-representation-'+i,'representation',REPRESENTATIONS.map(v=>[v,mt(v==='radix'?'radixLabel':v)]),c.representation)+
   field(tr('radix'),'<input type="number" min="2" max="36" name="column-radix-'+i+'" value="'+c.radix+'">')+
   field(tr('unit'),'<input name="column-unit-'+i+'" maxlength="100" value="'+esc(c.unit)+'">')+'</fieldset>';
 }
 function datasetForm(o,m){
  if(o.mapping?.kind!=='dataset'&&m.contentMode!=='dataset')return '';
  const d=m.dataset,s=d?.sourceMapping??{format:o.files[m.contentFile].selector.kind==='json-pointer'?'json':'delimited',rowsPath:o.files[m.contentFile].selector.value??'',delimiter:',',header:true},fields=s.fields??d?.columns?.map(c=>({name:c.name,path:''}))??[{name:'',path:''}];
  return '<details open><summary>'+text('datasetMapping')+'</summary>'+select('dataset-format','datasetFormat',[['delimited',tr('delimited')],['json',tr('jsonRows')],['jsonl',tr('jsonLines')]],s.format)+
   field(tr('rowsPath'),'<input name="dataset-rows" maxlength="2048" value="'+esc(s.rowsPath??'')+'">')+
   select('dataset-delimiter','delimiter',[[',',tr('comma')],['\t',tr('tab')],[';',tr('semicolon')],['|',tr('pipe')]],s.delimiter??',')+
   '<label class="check"><input type="checkbox" name="dataset-header" '+(s.header!==false?'checked':'')+'>'+text('headerRow')+'</label>'+
   '<p>'+text('datasetHelp')+'</p><div id="migration-import-columns">'+fields.map((f,i)=>datasetField(i,f,d?.columns?.[i])).join('')+'</div>'+button('addColumn','add-column')+
   '<details><summary>'+esc(mt('nativeMapping'))+'</summary><p>'+esc(mt('nativeMappingHelp'))+'</p>'+field(mt('nativeArtifact'),'<select name="native-file">'+options([['',mt('none')],...o.files.map((f,i)=>[i,f.path])],d?.nativeMapping?.file??'')+'</select>')+['offsetColumn','lengthColumn','pointerColumn','idColumn'].map(k=>field(mt(k),'<input name="native-'+k+'" type="number" min="1" max="256" value="'+(d?.nativeMapping?.[k]===null||d?.nativeMapping?.[k]===undefined?'':d.nativeMapping[k]+1)+'">')).join('')+'</details></details>';
 }
 function entry(report,source,manifest){
  return '<section class="panel migration-import"><h2>'+text('title')+'</h2><p>'+text('intro')+'</p>'+button('resume','list')+
   (report?.complete?'<form id="migration-import-create" data-no-draft>'+field(tr('destination'),'<select name="notebookId">'+notebookOptions(state.book.notebooks[0]?.id)+'</select>')+
    '<button class="button primary" '+(request||!state.book.notebooks.length?'disabled':'')+'>'+text('stage')+'</button></form>':'')+
   (error?'<p role="alert">'+esc(error)+'</p>':'')+'</section>';
 }
 function mappingForm(){
  const o=detail.source,m=detail.mapping,p=detail.prepared;
  return '<form id="migration-import-mapping" data-no-draft><h2>'+esc(o.title)+'</h2><p>'+esc(o.id)+' @ '+esc(o.revision)+'</p>'+
   '<fieldset aria-label="'+text('mapping')+'" '+(['mapping','ready'].includes(batch.state)?'':'disabled')+'>'+
   select('disposition','disposition',[['import',tr('import')],['exclude',tr('exclude')]],m.disposition)+
   field(tr('reason'),'<textarea name="reason" maxlength="2000">'+esc(m.reason)+'</textarea>')+
   field(tr('destination'),'<select name="notebookId">'+notebookOptions(m.notebookId)+'</select>')+
   field(tr('recordTitle'),'<input name="title" required maxlength="180" value="'+esc(m.title)+'">')+
   select('type','recordType',RECORD_TYPES.map(t=>[t.id,recordTypeLabel(t.id)]),m.type)+
   '<label class="check"><input name="current" type="checkbox" '+(m.current?'checked':'')+'>'+text('current')+'</label><p class="muted">'+text('currentHelp')+'</p>'+
   select('contentFile','contentFile',o.files.map((f,i)=>[i,f.path]),m.contentFile)+
   select('contentMode','contentMode',[['text',tr('text')],['json',tr('json')],['html',tr('html')],['html-book',tr('htmlBook')],...(o.mapping?.kind==='artifact'?[['original',tr('original')]]:[]),...(o.mapping?.kind==='dataset'?[['dataset',tr('dataset')]]:[]),...(o.mapping?.kind==='figure'?[['figure',tr('figure')]]:[])],m.contentMode)+datasetForm(o,m)+
   select('occurrence','occurrence',[[-1,tr('unknown')],...o.dates.map((d,i)=>[i,d.meaning+': '+(d.value??tr('unknown'))])],m.occurrence)+
   '<p class="muted">'+text('dateHelp')+'</p><fieldset><legend>'+text('contributors')+'</legend>'+m.contributors.map((c,i)=>'<div class="row">'+field(tr('contributorName'),'<input name="contributor-name-'+i+'" value="'+esc(c.name)+'" maxlength="160">')+field(tr('contributorRole'),'<input name="contributor-role-'+i+'" value="'+esc(c.role)+'" maxlength="160">')+'</div>').join('')+
   field(tr('newContributor'),'<input name="new-contributor" maxlength="160">')+field(tr('contributorRole'),'<input name="new-role" maxlength="160">')+'</fieldset>'+
   (o.links.length?'<fieldset><legend>'+text('relationships')+'</legend>'+o.links.map((l,i)=>'<details><summary>'+esc(l.type)+' → '+esc(l.id)+' @ '+esc(l.revision)+'</summary>'+
     select('link-mode-'+i,'linkMode',[['exact',tr('exact')],['current',tr('currentLink')],['omit',tr('omit')]],m.links[i].mode)+
     select('link-role-'+i,'linkRole',[['',tr('ordinaryLink')],['run-of',tr('runOf')],['uses-method',tr('usesMethod')],['compares',tr('compares')],['follows-run',tr('followsRun')]],m.links[i].role)+
     field(tr('reason'),'<input name="link-reason-'+i+'" maxlength="2000" value="'+esc(m.links[i].reason)+'">')+'</details>').join('')+'</fieldset>':'')+
   importResearchMapping(detail,esc,field)+select('metadataMode','metadataMode',[['provenance',tr('metadataProvenance')],['section',tr('metadataSection')]],m.metadataMode??'section')+'<p>'+text('metadataHelp')+'</p>'+
   (detail.attributesText?'<details><summary>'+text('originalMetadata')+'</summary><pre>'+esc(detail.attributesText)+'</pre></details>':'')+
   select('resolution','resolution',[['merge',tr('merge')],['source',tr('sourceWins')],['local',tr('localWins')]],m.resolution)+
   '<label class="check"><input type="checkbox" name="acknowledgeConversion" '+(m.acknowledgeConversion?'checked':'')+'>'+text('acknowledgeConversion')+'</label>'+
   '</fieldset>'+
   '<details><summary>'+text('sourceDetails')+'</summary><pre>'+esc(JSON.stringify(o,null,2))+'</pre></details>'+
   (detail.problem?'<section role="alert"><h3>'+text('omissions')+'</h3><p>'+esc(t('errors',detail.problem.code))+'</p><pre>'+esc(JSON.stringify(detail.problem.details,null,2))+'</pre></section>':'')+
   (p?'<details open><summary>'+text('preview')+'</summary><p>'+text(p.action)+'</p><p>'+text('conflicts',{fields:p.conflicts.map(key=>tr('field-'+key)).join(', ')||tr('none')})+'</p><div class="prose rich-document">'+renderProse(p.sourceRecord?.body??'')+'</div></details>'+bookSourceMap(p.conversion,o.files[m.contentFile],esc)+
     (p.dataset?.conflict?'<p role="alert">'+text('datasetConflict',{title:p.dataset.previous.title})+'</p>':'')+
     (p.currentRecord?'<details><summary>'+text('comparison')+'</summary>'+[...new Set([...p.changed,...p.conflicts])].filter(key=>key!=='dataset').map(key=>'<h3>'+text('field-'+key)+'</h3><h4>'+text('authored')+'</h4><pre>'+esc(JSON.stringify(p.currentRecord[key]??null,null,2))+'</pre><h4>'+text('proposed')+'</h4><pre>'+esc(JSON.stringify(p.sourceRecord[key]??null,null,2))+'</pre>').join('')+'</details>':''):'')+
   (p?.conflicts.includes('attempt')?'<p role="alert">'+text('attemptConflict')+'</p>':'')+importResearchPreview(p?.sourceRecord,esc)+datasetPreview()+
   '<div class="inline-actions">'+(['mapping','ready'].includes(batch.state)?'<button class="button primary" '+(request?'disabled':'')+'>'+text('saveMapping')+'</button>':'')+button('backBatch','back')+'</div></form>';
 }
 function datasetPreview(){
  const d=detail.datasetPreview;if(!d)return '';
  const cell=(value,kind)=>kind==='null'?text('nullValue'):kind==='absent'?text('absentValue'):value===''?text('emptyValue'):esc(value);
  return '<div class="migration-table-preview" tabindex="0" role="region" aria-label="'+text('datasetPreview')+'"><table><caption>'+text('datasetSample',{rows:d.rows.length,total:d.rowCount,columns:d.columns.length,totalColumns:d.columnCount})+'</caption><thead><tr><th scope="col">'+text('rowNumber')+'</th>'+d.columns.map(c=>'<th scope="col">'+esc(c.name)+'</th>').join('')+'</tr></thead><tbody>'+d.rows.map(r=>'<tr><th scope="row">'+r.order+'</th>'+r.cells.map((v,i)=>'<td>'+cell(v,r.valueKinds?.[i])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 }
 function view(){
  const status='<p id="migration-import-progress" role="status">'+(request?text('working'):batch?text('state-'+batch.state):'')+'</p>'+
   (error?'<p role="alert">'+esc(error)+'</p><div class="inline-actions">'+errorTargets.map(index=>'<button type="button" class="button" data-action="migration-import-detail" data-index="'+index+'">'+text('reviewObject',{number:index+1})+'</button>').join('')+'</div>':'');
  return '<div class="page-heading"><h1>'+text('title')+'</h1>'+button('backInventory','exit')+'</div><section class="panel migration-import">'+status+
   (request?'<button class="button" data-action="migration-import-pause">'+text('pause')+'</button>':'')+
   (detail?mappingForm():batch?batchView():list?'<h2>'+text('batches')+'</h2><ul>'+list.items.map(b=>'<li><strong>'+esc(b.source.title)+'</strong> '+esc(b.createdAt)+' · '+text('state-'+b.state)+' '+button('open','open','data-id="'+b.id+'"')+'</li>').join('')+'</ul>'+button('nextBatches','list-next',list.next?'':'disabled'):'')+'</section>';
 }
 function batchView(){
  const r=batch.reconciliation;
  const counts=keys=>'<dl class="migration-reconciliation">'+keys.map(k=>'<dt>'+text('count-'+k)+'</dt><dd>'+(r[k]??0)+'</dd>').join('')+'</dl>';
  const main=['create','update','unchanged','retain','exclude','conflicts','changedSources'];
  return '<h2>'+esc(batch.source.title)+'</h2><p>'+esc(batch.source.revision)+'</p><p>'+text('privateHelp')+'</p>'+
   '<details><summary>'+text('identity')+'</summary><p>'+esc(batch.source.namespace)+'</p><p>'+esc(batch.source.pin)+'</p></details>'+
   (r?counts(main.filter(key=>r[key]))+'<details><summary>'+text('reconciliationDetails')+'</summary>'+counts(Object.keys(r))+'</details>':'')+
   '<div class="inline-actions">'+(['staging','reviewing'].includes(batch.state)?button('continue','continue'):'')+
   (['mapping','ready'].includes(batch.state)?button('review','review'):'')+(batch.state==='ready'?button('apply','apply'):'')+
   (batch.state==='committed'?button('evidenceCheck','evidence-start')+button('reverse','confirm-reverse'):'')+'</div>'+evidence.view()+
   (batch.reversal?'<dl class="migration-reconciliation">'+Object.entries(batch.reversal.counts).filter(([,count])=>count).map(([disposition,count])=>'<dt>'+text(disposition)+'</dt><dd>'+count+'</dd>').join('')+'</dl>':'')+
   '<div class="inventory-objects">'+(result?.items??[]).map(row=>'<article><strong>'+esc(row.title)+'</strong><small>'+esc(row.id)+' @ '+esc(row.revision)+'</small><p>'+text(row.prepared?.action??row.disposition)+'</p>'+
    (row.reason?'<p>'+esc(row.reason)+'</p>':'')+(row.problem?'<p role="alert">'+esc(t('errors',row.problem.code))+'</p>':'')+
    (row.prepared?.conflicts.length?'<p>'+text('conflicts',{fields:row.prepared.conflicts.map(key=>tr('field-'+key)).join(', ')})+'</p>':'')+
    (row.prepared?.sourceChanged?'<p>'+text('changedSource')+'</p>':'')+
    (row.reversal?Object.values(row.reversal).map(r=>'<p>'+text(r.disposition)+'</p>').join(''):'')+
    '<div class="inline-actions">'+button('mapping','detail','data-index="'+row.index+'"')+(row.recordId?button('openRecord','open-record','data-id="'+row.recordId+'"'):'')+'</div></article>').join('')+'</div>'+
   button('previous','previous',offset?'':'disabled')+button('next','next',result?.next!==null?'':'disabled');
 }
 async function submit(form,{report,source,manifest}={}){
  if(form.id==='migration-import-create'){
   const notebookId=new FormData(form).get('notebookId'),intent={source,manifest,expectedPin:report.source.pin,notebookId};
   if(!creation||Object.keys(intent).some(key=>creation[key]!==intent[key]))creation={id:crypto.randomUUID(),...intent};evidence.reset();open=true;
   await busy(async signal=>{batch=await call('create',creation,signal);creation=null;offset=0;await runSteps(signal);});return true;
  }
  if(form.id!=='migration-import-mapping')return false;
  const data=new FormData(form),mapping={...detail.mapping};
  for(const key of ['disposition','reason','notebookId','title','type','contentMode','resolution','metadataMode'])mapping[key]=data.get(key);
  for(const key of ['contentFile','occurrence'])mapping[key]=Number(data.get(key));
  for(const key of ['current','acknowledgeConversion'])mapping[key]=data.has(key);
  mapping.research=data.get('researchPath')?.startsWith('path:')?{path:data.get('researchPath').slice(5)}:null;
  mapping.contributors=mapping.contributors.map((_,i)=>({name:data.get('contributor-name-'+i),role:data.get('contributor-role-'+i)})).filter(c=>c.name.trim());
  if(data.get('new-contributor')?.trim())mapping.contributors.push({name:data.get('new-contributor'),role:data.get('new-role')});
  mapping.links=mapping.links.map((_,i)=>({mode:data.get('link-mode-'+i),role:data.get('link-role-'+i),reason:data.get('link-reason-'+i)}));
  if(mapping.contentMode==='dataset'){
   const count=form.querySelectorAll('[data-import-column]').length,fields=[],columns=[];
   for(let i=0;i<count;i++){const name=data.get('column-name-'+i)?.trim();if(!name)continue;fields.push({name,path:data.get('column-path-'+i)});columns.push({missing:[],time:{kind:'none',reference:'',resolution:'',uncertainty:''},...mapping.dataset?.columns?.[i],name,representation:data.get('column-representation-'+i),radix:Number(data.get('column-radix-'+i)),unit:data.get('column-unit-'+i)});}
   const format=data.get('dataset-format');mapping.dataset={sourceMapping:format==='delimited'?{format,delimiter:data.get('dataset-delimiter'),header:data.has('dataset-header')}:{format,rowsPath:data.get('dataset-rows'),fields},columns:columns.length?columns:null};
   if(data.get('native-file')!=='')mapping.dataset.nativeMapping={file:Number(data.get('native-file')),...Object.fromEntries(['offsetColumn','lengthColumn','pointerColumn','idColumn'].map(k=>[k,data.get('native-'+k)===''?null:Number(data.get('native-'+k))-1]))};
  }else mapping.dataset=null;
  await busy(async signal=>{batch=await call('mapping',{index:detail.index,edit:batch.edit,mapping},signal);await page(signal);});return true;
 }
 async function action(control){
  const name=control.dataset.action;if(!name?.startsWith('migration-import-'))return false;const act=name.slice(17);
  if(act==='pause'){request?.abort();return true;}if(request)return true;
  if(act==='open-record'){location.hash='#/records/'+control.dataset.id;return true;}
  if(act==='add-column'){const list=document.getElementById('migration-import-columns'),count=list.querySelectorAll('[data-import-column]').length;if(count<256)list.insertAdjacentHTML('beforeend',datasetField(count));return true;}
  if(act==='exit'){open=false;detail=null;render();return true;}
  if(act==='back'){detail=null;render();return true;}
  if(act==='confirm-reverse'){
   showDialog('<h2 id="dialog-title">'+text('reverseTitle')+'</h2><p>'+text('reverseHelp')+'</p><div class="dialog-actions">'+button('reverse','reverse')+'<button class="button" data-action="close-dialog">'+text('cancel')+'</button></div>');return true;
  }
  await busy(async signal=>{
   if(await evidence.action(act,signal))return;
   if(act==='list'||act==='list-next'){evidence.reset();open=true;batch=result=detail=null;listAfter=act==='list-next'?list?.next:null;list=await call('list',{after:listAfter},signal);}
   if(act==='open'){evidence.reset();batch={id:control.dataset.id};offset=0;await page(signal);}
   if(act==='continue')await runSteps(signal);
   if(act==='review'){batch=await call('beginReview',{edit:batch.edit},signal);await runSteps(signal);}
   if(act==='apply'){batch=await call('commit',{review:batch.review},signal);await page(signal);}
   if(act==='reverse'){document.getElementById('dialog').close();batch=await call('reverse',{review:batch.review},signal);evidence.reset();await page(signal);}
   if(act==='detail')detail=await call('detail',{index:Number(control.dataset.index)},signal);
   if(act==='previous'||act==='next'){offset=act==='previous'?Math.max(0,offset-20):result.next;await page(signal);}
  });return true;
 }
 return {bind,entry,view,submit,action,active:()=>open};
}
