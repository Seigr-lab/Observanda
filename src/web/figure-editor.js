import {scientificText as st,figureTypeOptions} from './scientific-editor-text.js';
import {axisControls,axisControlInput,axisControlAction} from './figure-axis-controls-ui.js';
import {referencedObservation,removedObservation} from './figure-observation-annotations.js';
import {observationText} from './figure-observation-ui.js';
import {markerControls,markerText} from './figure-marker-area-ui.js';
import {defaultMarkerArea} from './figure-marker-area.js';
import {intervalText,intervalHeaders,intervalCells} from './figure-intervals-ui.js';
import {defaultHeatmap} from './figure-heatmap.js';
import {heatmapControls,readHeatmap,heatmapAction,heatmapText} from './figure-heatmap-ui.js';

import {FIGURE_TYPES,createFigure,createSeries,figureIssues,figureCSV} from './figure-model.js';
import {figureSummary,renderFigure} from './figure-renderer.js';
import {figureImportUI} from './figure-import-ui.js';
import {figurePreviews} from './figure-preview.js';
import {figureNumericInputs} from './figure-numeric-input.js';
import {decimalPlotProjection} from './measurement-projection.js';
import {figureDesignView,figureDesignInput} from './figure-design-ui.js';
import {setFigureDesign} from './figure-style.js';
import {createComposition,cloneFigure,figurePlots} from './figure-composition.js';
import {figureCompositionUI} from './figure-composition-ui.js';
import {t} from './i18n/index.js';
import {figureHasResults,copyFigureResults} from './figure-result-links.js';
import {figureSourceView} from './figure-provenance-ui.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options=(items,value)=>items.map(([id,label])=>`<option value="${id}" ${id===value?'selected':''}>${esc(label)}</option>`).join('');
const fieldInput=(name,label,value,type='text')=>`<label>${esc(label)}<input aria-label="${esc(label)}" data-figure-field="${name}" type="${type}" ${type==='number'?'step="any"':''} value="${esc(value)}"></label>`;
const select=(name,label,items,value)=>`<label>${esc(label)}<select aria-label="${esc(label)}" data-figure-field="${name}">${options(items,value)}</select></label>`;
const button=(action,label,extra='')=>`<button type="button" class="button" data-action="figure-${action}" ${extra}>${esc(label)}</button>`;
export function figureEditor({getFigures,getResults=()=>null,setResults=()=>{},prepareCopies=async()=>{},selectCopy=null,copyPairs=null,busyChanged=()=>{},changed,notify,context,root=()=>document,selectedOnly=false}){
 const selected=new Map(),designTabs=new Map(),previews=figurePreviews();
 let studio=null,copying=false;
 const prepare=async plots=>{
  copying=true;busyChanged();
  const hosts=[...root().querySelectorAll('.record-figures,.figure-studio')],controls=hosts.flatMap(host=>[...host.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]));
  hosts.forEach(host=>host.setAttribute('aria-busy','true'));controls.forEach(([el])=>el.disabled=true);
  try{await prepareCopies(plots);}finally{copying=false;for(const [el,disabled] of controls)if(el.isConnected)el.disabled=disabled;hosts.forEach(host=>host.removeAttribute('aria-busy'));busyChanged();}
 };
 const owner=id=>getFigures().find(f=>f.id===id||figurePlots(f).some(p=>p.id===id));
 const get=id=>{const root=owner(id);return root?.id===id?root:root&&figurePlots(root).find(p=>p.id===id);};
 const copied=pairs=>{if(copyPairs){copyPairs(pairs);return;}const before=getResults(),after=copyFigureResults(before,pairs);if(after!==before)setResults(after);};
 const canRemove=f=>{if(!figureHasResults(f,getResults()))return true;notify(t('figureComposition','resultAttached'),true);return false;};
 const composition=figureCompositionUI({esc,getFigures,refresh,changed,update:updatePlot,copied,canRemove,prepare,selectCopy});
 const importer=figureImportUI({getFigure:get,context,previews,apply(figure,candidate){
  if(!candidate.summary)delete figure.summary;
  // A reviewed replacement without a count column uses fixed-size markers.
  // Follow the mapper's explicit choice; preserve all other figure metadata.
  if(!Object.hasOwn(candidate,'markerArea'))delete figure.markerArea;
  Object.assign(figure,candidate);selected.delete(figure.id);changed();refresh(figure.id);
  const plot=root().querySelector('[data-figure-id="'+figure.id+'"] [data-figure-preview]');
  plot?.scrollIntoView({block:'nearest',behavior:'smooth'});
  notify(st("mappedApplied"));
 }});
 const current=f=>f.series.find(s=>s.id===selected.get(f.id))??f.series[0];
 const numericInputs=figureNumericInputs({notify});

 function paint(f,host){
  const plot=host.querySelector('[data-figure-preview]'),errors=[numericInputs.issue(f),...figureIssues(f)].filter(Boolean);
  host.querySelector('[data-figure-validation]').innerHTML=errors.slice(0,4).map(e=>'<p>'+esc(e)+'</p>').join('');
  if(errors.length){previews.release(plot);plot.innerHTML='<div class="figure-empty">'+esc(st("completeMeasurements"))+'</div>';}
  else previews.mount(plot,f,'editor');
  const summary=[...host.querySelectorAll('[data-figure-summary]')].find(el=>el.closest('[data-figure-id]')===host);
  if(summary)summary.textContent=figureSummary(f);
 }
 function bind(){
  previews.prune();
  for(const host of root().querySelectorAll('[data-figure-id]')){
   const f=get(host.dataset.figureId);
   if(f){paint(f,host);numericInputs.restore(host,f);if(f.kind!=='panels')importer.bind(host,f);}
  }
 }
 function closeStudio(){
  if(!studio)return;
  const current=studio;studio=null;
  const card=current.dialog.querySelector('.figure-workbench');
  if(current.placeholder.isConnected){if(card)current.placeholder.replaceWith(card);else current.placeholder.remove();}
  current.dialog.close();current.dialog.remove();bind();
  window.scrollTo({top:current.scroll,behavior:'instant'});
  if(current.trigger.isConnected)current.trigger.focus({preventScroll:true});
 }
 function expand(host,trigger){
  if(studio){closeStudio();return;}
  const scroll=window.scrollY,placeholder=document.createElement('div'),dialog=document.createElement('dialog');
  placeholder.className='figure-studio-placeholder';
  placeholder.style.height=host.getBoundingClientRect().height+'px';
  host.replaceWith(placeholder);
  dialog.className='figure-studio';
  dialog.setAttribute('aria-label',st("expandedEditor"));
  dialog.innerHTML='<div class="figure-studio-bar"><strong>'+esc(st("figureWorkspace"))+'</strong><span>'+esc(st("draftChanges"))+'</span><button type="button" class="button" data-action="figure-studio-close">'+esc(st("backToRecord"))+'</button></div>';
  dialog.append(host);document.body.append(dialog);studio={dialog,placeholder,trigger,scroll};
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeStudio();});
  dialog.querySelector('[data-action="figure-studio-close"]').addEventListener('click',closeStudio);
  dialog.showModal();bind();
  if(trigger.closest('.figure-import'))host.querySelector('.figure-import').scrollIntoView({block:'start'});
 }
 function bound(f,key,label){const date=key.startsWith('x.')&&f.x.kind==='date',value=f[key[0]][key.slice(2)];return fieldInput(key,label,date&&value!==null?new Date(value).toISOString().slice(0,10):value,date?'date':'number');}
 function card(f,panel=false){
  if(f.kind==='panels')return `<article class="figure-workbench figure-composition" data-figure-id="${f.id}"><header><h4>${esc(f.title)}</h4><div class="inline-actions">${selectedOnly?'':button('expand',st("expandEditor"))}${button('svg',st("downloadSVG"))}${button('csv',st("downloadData"))}${selectedOnly?'':button('duplicate',st("duplicate"))+button('remove',t("retainedFigureEditor","remove"))}</div></header><div data-figure-validation role="status"></div><div class="figure-preview" data-figure-preview></div>${composition.view(f,card)}</article>`;
  const s=current(f);
  return `<article class="figure-workbench" data-figure-id="${f.id}">
   <header><h4>${esc(f.title)}</h4><div class="inline-actions">${panel||selectedOnly?'':button('expand',st("expandEditor"))}${button('svg',st("downloadSVG"))}${button('csv',st("downloadData"))}${panel||selectedOnly?'':button('duplicate',st("duplicate"))+button('remove',t("retainedFigureEditor","remove"))}</div></header>

   ${figureSourceView(f,esc)}<div class="figure-basics">${select('kind',t("retainedFigureEditor","kind"),figureTypeOptions(FIGURE_TYPES),f.kind)}${select('x.kind',f.kind==='bar-horizontal'?st("categoryCoordinates"):st("horizontalCoordinates"),f.kind==='heatmap'?[['category',st("categories")]]:[['number',t("retainedFigureEditor","option_number")],['date',st("dateTime")],['category',st("categories")]],f.x.kind)}</div>
   <div class="figure-presentation-workspace">
    <div class="figure-preview-column"><div class="figure-validation" data-figure-validation role="status"></div><div class="figure-preview" data-figure-preview></div><p class="editor-hint" data-figure-summary>${esc(figureSummary(f))}</p></div>
    <div data-figure-design-host>${figureDesignView(f,{tab:designTabs.get(f.id)??'text'})}</div>
   </div>
   <details class="figure-axis"${f.kind==='heatmap'?' hidden':''}><summary>${esc(st("axisRanges"))}</summary><div class="figure-basics">${select('x.scale',st("coordinateScale"),[['linear',t("retainedFigureEditor","option_linear")],['log',t("retainedFigureEditor","option_log")]],f.x.scale)}${select('y.scale',st("valueScale"),[['linear',t("retainedFigureEditor","option_linear")],['log',t("retainedFigureEditor","option_log")]],f.y.scale)}${bound(f,'x.min',st("coordinateMinimum"))}${bound(f,'x.max',st("coordinateMaximum"))}${bound(f,'y.min',st("valueMinimum"))}${bound(f,'y.max',st("valueMaximum"))}</div><p class="editor-hint">${esc(st("boundsHelp"))}</p></details>
   ${f.kind==='heatmap'?'':axisControls(f,esc)+markerControls(f,esc)}
   <div class="figure-series"><label>${esc(st("editingSeries"))}<select data-figure-series>${options(f.series.map(s=>[s.id,s.name]),s.id)}</select></label>${button('series-add',st("addSeries"))}${button('series-remove',st("removeSeries"),f.series.length===1?'disabled':'')}</div>
   <p class="editor-hint"${f.kind==='heatmap'?' hidden':''}>${esc(f.x.kind==='category'?st("categorySpacing"):st("coordinatePositions"))} ${esc(st("lineOrder"))} ${esc(intervalText('help'))}</p>
   <div class="table-scroll"><table class="figure-data"><thead><tr><th>${esc(f.x.label||st("horizontalCoordinate"))}</th><th>${esc(f.y.label||t("retainedFigureEditor","value"))}</th><th${f.kind==='heatmap'?' hidden':''}>${esc(st("uncertaintySymmetric"))}</th>${f.kind==='heatmap'?'':intervalHeaders(esc)}${f.markerArea?'<th>'+esc(markerText('count'))+'</th>':''}<th></th></tr></thead><tbody>${s.points.map((p,i)=>`<tr>${['x','y','error'].map(key=>`<td${key==='error'&&f.kind==='heatmap'?' hidden':''}><input aria-label="${esc(st("measurementCell",{label:key==='x'?t("retainedFigureEditor","point.x"):key==='y'?t("retainedFigureEditor","value"):t("figureComposition","uncertainty"),position:i+1}))}" data-figure-row="${i}" data-figure-column="${key}" type="${key==='x'&&f.x.kind!=='number'?'text':'number'}" step="any" value="${esc(p[key])}" ${key==='error'?'min="0"':''}></td>`).join('')}${f.kind==='heatmap'?'':intervalCells(p,i,f,esc)}${f.markerArea?`<td><input aria-label="${esc(st("measurementCell",{label:markerText('count'),position:i+1}))}" data-figure-row="${i}" data-figure-column="count" type="number" min="0" step="1" value="${esc(p.count??'')}"></td>`:''}<td>${button('row-remove','×',`data-index="${i}" aria-label="${esc(st("removeMeasurement",{position:i+1}))}"`)}</td></tr>`).join('')}</tbody></table></div>
   ${button('row-add',st("addMeasurement"))}
   ${f.kind==='heatmap'?heatmapControls(f.heatmap,{esc}):composition.annotations(f)}
   ${importer.view(f)}
  </article>`;
 }
 function view(){return `<section class="record-figures">${selectedOnly?'':`<div class="section-bar"><h3>${esc(st("figures"))}</h3><div class="inline-actions">${button('add',st("addFigure"))}${button('panels-add',t('figureComposition','add'))}</div></div>`}<div data-figure-cards>${getFigures().map(f=>card(f)).join('')}</div></section>`;}
 function refresh(id){
  const f=owner(id),host=f&&root().querySelector(`[data-figure-id="${f.id}"]`);if(!host)return;
  const open=[];
  for(const plot of figurePlots(f)){
   const panel=host.dataset.figureId===plot.id?host:host.querySelector(`[data-figure-id="${plot.id}"]`);if(!panel)continue;importer.capture(panel);
   for(const selector of ['.figure-annotations','.figure-axis','.figure-axis-controls','.figure-marker-settings'])if(panel.querySelector(selector)?.open)open.push({id:plot.id,selector});
  }
  host.outerHTML=card(f);for(const item of open){const details=root().querySelector(`[data-figure-id="${item.id}"] ${item.selector}`);if(details)details.open=true;}bind();
 }
 function updatePlot(f,host){
  paint(f,host);host.querySelector('h4').textContent=f.title;
  if(f.kind!=='panels'){const series=current(f),choice=host.querySelector('[data-figure-series] option:checked');if(choice)choice.textContent=series.name;importer.update(host,f);}
  const ownerFigure=owner(f.id);if(ownerFigure&&ownerFigure!==f){const outer=root().querySelector(`[data-figure-id="${ownerFigure.id}"]`);if(outer)paint(ownerFigure,outer);}
 }
 function input(el){
  const host=el.closest('[data-figure-id]');if(!host)return false;
  const f=get(host.dataset.figureId);if(!f)return false;
  if(numericInputs.has(f)&&!numericInputs.numeric(el)){
   refresh(f.id);numericInputs.blocked();return true;
  }
  if(numericInputs.input(el,f)===false){changed();updatePlot(f,host);return true;}
  if(el.dataset.figureField==='kind'&&el.value==='heatmap'&&(f.annotations?.length||f.x.reversed||f.y.reversed||f.x.ticks?.length||f.y.ticks?.length||f.series.some(s=>s.points.some(p=>p.error!==null)))){el.value=f.kind;notify(heatmapText('matrixInvalid'),true);return true;}
  if(el.dataset.figureField==='x.kind'&&el.value==='category'&&f.x.ticks?.length){el.value=f.x.kind;notify(t('figureAxes','invalid'),true);return true;}
  if(el.dataset.figureField==='x.kind'&&el.value==='number'){
   try{for(const series of f.series)for(const p of series.points)if(typeof p.x==='string'&&p.x.trim())decimalPlotProjection(p.x);}
   catch{el.value=f.x.kind;notify(t('measurements','plotPrecision'),true);return true;}
  }
  if(el.hasAttribute('data-marker-area')){const key=el.dataset.markerArea;if(key==='enabled'){if(el.checked)f.markerArea??=defaultMarkerArea();else delete f.markerArea;changed();refresh(f.id);}else{f.markerArea??=defaultMarkerArea();f.markerArea[key]=key==='unitArea'?Number(el.value):el.value;changed();updatePlot(f,host);}return true;}
  if(el.hasAttribute('data-heatmap-field')){try{f.heatmap=readHeatmap(host);changed();updatePlot(f,host);}catch(error){notify(error.message,true);}return true;}
  if(axisControlInput(el,f)){changed();updatePlot(f,host);return true;}
  if(composition.input(el,f,host))return true;
  if(f.kind==='panels')return false;
  if(importer.input(el,f,host))return true;
  const design=figureDesignInput(el);
  if(design){setFigureDesign(f,design.path,design.value,design.key===undefined?null:Number(design.key));changed();updatePlot(f,host);return true;}
  if(el.matches('[data-figure-series]')){selected.set(f.id,el.value);refresh(f.id);return true;}
  if(el.dataset.figureRow!==undefined){delete f.summary;const p=current(f).points[Number(el.dataset.figureRow)],key=el.dataset.figureColumn;p[key]=['x','xLower','xUpper'].includes(key)&&f.x.kind!=='number'?(el.value.trim()?el.value:null):el.value.trim()===''?null:Number(el.value);}
  else if(el.dataset.figureField){
   const path=el.dataset.figureField.split('.'),parent=path.length===1?f:path[0]==='series'?current(f):f[path[0]],key=path.at(-1);
   parent[key]=el.type==='date'?(el.value?Date.parse(el.value):null):el.type==='checkbox'?el.checked:el.type==='number'?(el.value.trim()===''?null:Number(el.value)):el.value;
   if(el.dataset.figureField==='kind'){if(['bar','bar-horizontal','area'].includes(f.kind))f.y.scale='linear';if(f.kind==='heatmap'){f.heatmap??=defaultHeatmap();f.x.kind='category';f.x.scale='linear';f.y.scale='linear';for(const s of f.series)for(const p of s.points)p.x=String(p.x??'');}changed();refresh(f.id);return true;}
   if(el.dataset.figureField==='kind'&&['bar','bar-horizontal','area'].includes(f.kind))f.y.scale='linear';
   if(el.dataset.figureField==='x.kind'){
    delete f.summary;
    if(f.x.kind!=='number')f.x.scale='linear';
    for(const s of f.series)for(const p of s.points){if(f.x.kind==='number'){const n=Number(p.x);if(p.x!==null&&String(p.x).trim()&&Number.isFinite(n))p.x=n;}else p.x=String(p.x??'');}
    changed();refresh(f.id);return true;
   }
  }else return false;
  changed();updatePlot(f,host);return true;
 }
 function download(text,type,name){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function action(el){
  if(el.dataset.heatmapAdd!==undefined||el.dataset.heatmapRemove!==undefined){const host=el.closest('[data-figure-id]'),f=host&&get(host.dataset.figureId);if(!f)return false;try{f.heatmap=readHeatmap(host);if(heatmapAction(el,f.heatmap)){changed();refresh(f.id);}}catch(error){notify(error.message,true);}return true;}
  const name=el.dataset.action;if(!name?.startsWith('figure-'))return false;
  if(selectedOnly&&['figure-add','figure-panels-add','figure-duplicate','figure-remove','figure-expand'].includes(name))return true;
  if(numericInputs.blocked())return true;
  if(copying)return true;
  const host=el.closest('[data-figure-id]'),f=host?get(host.dataset.figureId):null,items=getFigures();
  if(name==='figure-panels-add'){
   const sources=items.filter(f=>f.kind!=='panels'),plots=sources.length>=2?sources.slice(0,2):[sources[0]??createFigure(),createFigure()];
   await prepare(plots);const added=createComposition(plots);
   copied(plots.map((source,i)=>[source,added.panels[i].figure]));items.push(added);document.querySelector('[data-figure-cards]').insertAdjacentHTML('beforeend',card(added));changed();bind();return true;
  }
  if(name==='figure-add'){const added=createFigure();added.series[0].points=[{x:null,y:null,error:null}];items.push(added);document.querySelector('[data-figure-cards]').insertAdjacentHTML('beforeend',card(added));changed();bind();return true;}
  if(!f)return true;
  if(axisControlAction(el,f)){changed();refresh(f.id);return true;}
  if(await composition.action(el,f))return true;
  if(importer.action(el,f,host))return true;
  if(name==='figure-expand'){expand(host,el);return true;}
  if(name==='figure-design-tab'){designTabs.set(f.id,el.dataset.tab);host.querySelector('[data-figure-design-host]').innerHTML=figureDesignView(f,{tab:el.dataset.tab});return true;}
  if(name==='figure-svg'||name==='figure-csv'){const issues=figureIssues(f);if(issues.length){notify(issues[0],true);return true;}download(name==='figure-svg'?renderFigure(f):figureCSV(f),name==='figure-svg'?'image/svg+xml':'text/csv',f.title.replace(/[^\p{L}\p{N} _-]/gu,'_')+(name==='figure-svg'?'.svg':'.csv'));return true;}
  if(name==='figure-remove'){if(!canRemove(f)||!confirm(st("removeFigureConfirm")))return true;items.splice(items.indexOf(f),1);host.remove();closeStudio();selected.delete(f.id);importer.forget(f.id);}
  else if(name==='figure-duplicate'){await prepare([f]);const copy=cloneFigure(f);copy.title+=' (copy)';copied([[f,copy]]);items.splice(items.indexOf(f)+1,0,copy);(studio?.dialog.contains(host)?studio.placeholder:host).insertAdjacentHTML('afterend',card(copy));}
  else if(name==='figure-series-add'){delete f.summary;const s=createSeries('Series '+(f.series.length+1),f.series.length);s.points=current(f).points.map(p=>({x:p.x,y:null,error:null}));f.series.push(s);if(f.series.length===2)f.legend=true;selected.set(f.id,s.id);refresh(f.id);}
  else if(name==='figure-series-remove'){if(referencedObservation(f,current(f).id)){notify(observationText('referenced'),true);return true;}if(f.series.length<2||!confirm(st("removeSeriesConfirm")))return true;delete f.summary;f.series.splice(f.series.indexOf(current(f)),1);refresh(f.id);}
  else if(name==='figure-row-add'){delete f.summary;current(f).points.push({x:null,y:null,error:null});refresh(f.id);root().querySelector(`[data-figure-id="${f.id}"] .figure-data tbody tr:last-child input`)?.focus();}
  else if(name==='figure-row-remove'){if(referencedObservation(f,current(f).id,Number(el.dataset.index))){notify(observationText('referenced'),true);return true;}removedObservation(f,current(f).id,Number(el.dataset.index));delete f.summary;current(f).points.splice(Number(el.dataset.index),1);refresh(f.id);}
  else return true;
  changed();bind();return true;
 }
 return {view,input,action,bind,isBusy:()=>copying,release(){closeStudio();previews.release();numericInputs.clear();},validate(){numericInputs.validate();for(const f of getFigures()){const errors=figureIssues(f);if(errors.length)throw new Error(f.title+': '+errors[0]);}}};
}
