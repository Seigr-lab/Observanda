import {markerMapping} from './figure-marker-area-ui.js';
import {INTERVAL_FIELDS} from './figure-intervals.js';
import {intervalMappingControls} from './figure-intervals-ui.js';
import {MAX_TABLE_TEXT, TABLE_DELIMITERS, readDelimitedTable} from './tabular-data.js';
import {figureColumns, suggestFigureMapping, mapFigureTable, FIGURE_OPERATIONS} from './figure-import-model.js';
import {FIGURE_TYPES,figureIssues} from './figure-model.js';
import {figureSummary} from './figure-renderer.js';
import {figureDesignView, figureDesignInput} from './figure-design-ui.js';
import {setFigureDesign} from './figure-style.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const options = (items, value) => items.map(([id, label]) => `<option value="${esc(id)}" ${String(id) === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('');
const button = (action, label, extra = '') => `<button type="button" class="button" data-action="figure-import-${action}" ${extra}>${label}</button>`;
const select = (key, label, items, value) => `<label>${label}<select aria-label="${esc(label)}" data-import-map="${key}">${options(items, value)}</select></label>`;
const kindLabel = {number:'Numeric', date:'Date / time', text:'Text', mixed:'Mixed values', empty:'Empty'};
const pageSize = 8;

// The import session is separate from research state. Only Apply commits its
// validated candidate through the figure editor's ordinary save boundary.
export function figureImportUI({getFigure, apply, context = () => null, previews}) {
  const sessions = new Map();
  let owner;
  function session(id) {
    if (owner !== context()) { sessions.clear(); owner = context(); }
    if (!sessions.has(id)) sessions.set(id, {source:'', name:'', delimiter:'auto', header:true, decimal:'.', table:null, mapping:null, error:'', open:false, sourceOpen:true, stale:false, page:0, version:0, columnSearch:'', tableOpen:false, designTab:'text', design:{fields:{},series:{}}});
    return sessions.get(id);
  }

  function result(state, figure) {
    const candidate=state.table&&!state.stale?mapFigureTable(state.table,state.mapping,figure):null;
    if(candidate?.figure){
      state.seriesKeys=candidate.figure.series.map(series=>series.name);
      for(const [path,value] of Object.entries(state.design.fields))setFigureDesign(candidate.figure,path,value);
      candidate.figure.series.forEach((series,index)=>{
        for(const [path,value] of Object.entries(state.design.series[state.seriesKeys[index]]??{}))setFigureDesign(candidate.figure,path,value,index);
      });
    }
    if(candidate?.figure){
      const issues=figureIssues(candidate.figure);
      if(issues.length){candidate.issues.push(...issues.map(message=>({line:null,column:null,message})));}
    }
    state.candidate=candidate;
    return candidate;
  }
  function mappedTable(state, candidate) {
    const table=state.table,mapping=state.mapping,count=mapping.operation==='count';
    const columns=table.columns.filter(c=>c.label.toLocaleLowerCase().includes(state.columnSearch.toLocaleLowerCase()));
    const selected=new Set([mapping.x,mapping.group,...(count?[]:mapping.values.flatMap(v=>[v.column,v.error,...INTERVAL_FIELDS.map(k=>v[k])]))]);
    const errors=new Set(candidate.issues.filter(e=>e.line!==null).map(e=>e.line+':'+e.column));
    const role=column=>[
      column.index===mapping.x?'Coordinate':'',
      column.index===mapping.group?'Series group':'',
      !count&&mapping.values.some(v=>v.column===column.index)?'Measure':'',
      !count&&mapping.operation==='raw'&&mapping.values.some(v=>v.error===column.index)?'Uncertainty':''
    ].filter(Boolean).join(' · ')||'Context';
    const start=Math.min(state.page*pageSize,Math.max(0,table.rows.length-1));
    return `<details class="figure-source-table" ${state.tableOpen?'open':''}>
      <summary class="figure-import-section-title"><strong>Explore source data</strong><span>${table.columns.length} columns · ${table.rows.length} rows</span></summary>
      <div class="figure-table-tools">
       <label>Find columns<input type="search" aria-label="Find columns" data-import-column-search value="${esc(state.columnSearch)}" placeholder="Column name"></label>
       <label>Jump to column<select aria-label="Jump to column" data-import-column-jump><option value="">Choose a column</option>${options(table.columns.map(c=>[c.index,c.label]),'')}</select></label>
       <span>${columns.length} of ${table.columns.length} columns · Rows ${start+1}–${Math.min(start+pageSize,table.rows.length)}</span>
      </div>
      <div class="table-scroll" tabindex="0" aria-label="Imported data preview">
       <table><thead><tr><th scope="col">Line</th>${columns.map(c=>`<th scope="col" data-source-column="${c.index}" class="${selected.has(c.index)?'is-mapped':''}">${esc(c.label)}<small>${role(c)}</small></th>`).join('')}</tr></thead>
       <tbody>${table.rows.slice(start,start+pageSize).map(row=>`<tr><th scope="row">${row.line}</th>${columns.map(c=>`<td class="${errors.has(row.line+':'+c.index)?'has-error':''}">${esc(row.cells[c.index])||'<span class="figure-cell-empty">Empty</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table>
       ${columns.length?'':'<p>No columns match this search.</p>'}
      </div>
      ${table.rows.length>pageSize?`<div class="figure-table-pages">${button('previous','Previous rows',state.page===0?'disabled':'')}${button('next','Next rows',start+pageSize>=table.rows.length?'disabled':'')}</div>`:''}
      <p class="editor-hint">All source columns are available here. Only mapped measurements are copied into the figure.</p>
    </details>`;
  }
  function paint(host,state,figure){
    const candidate=state.candidate,plot=host.querySelector('.figure-import-plot');
    if(!plot)return;
    if(!candidate?.figure){previews.release(plot);plot.innerHTML='<div class="figure-empty">Choose a numeric measure, or count rows by a category.</div>';return;}
    let preview=candidate.figure;
    const count=preview.series.reduce((n,s)=>n+s.points.length,0);
    if(count>2000){
      preview=structuredClone(preview);
      const perSeries=Math.max(1,Math.floor(2000/preview.series.length));
      preview.series.forEach(s=>s.points=s.points.slice(0,perSeries));
    }
    previews.mount(plot,preview,'import-'+figure.id);
  }
  function designPanel(state){
    return state.candidate?.figure?figureDesignView(state.candidate.figure,{tab:state.designTab,keys:state.seriesKeys}):'';
  }

  function mappingView(state,figure){
    if(!state.table)return '';
    if(state.stale)return '<p class="figure-import-status" role="status">Source changed. Select Review data to refresh the columns and preview.</p>';
    const mapping=state.mapping,columns=figureColumns(state.table,state.decimal),choices=columns.map(c=>[c.index,c.label]);
    const measures=columns.filter(c=>c.numeric>0),categories=columns.filter(c=>c.kind!=='number');
    const candidate=result(state,figure),count=mapping.operation==='count',ready=candidate.figure&&!candidate.issues.length;
    const issueText=issue=>(issue.line!==null?'Line '+issue.line+', '+state.table.columns[issue.column].label+': ':'')+issue.message;
    return `
    ${mappedTable(state,candidate)}
    <div class="figure-import-section-title"><strong>Build your graph</strong><span>${state.table.rows.length} rows · ${columns.length} columns</span></div>
    <div class="figure-map-layout">
     <div class="figure-mapping-controls">
      ${select('operation','Show',FIGURE_OPERATIONS,mapping.operation??'raw')}
      ${select('x','Coordinate column',choices,mapping.x)}
      ${select('xKind','Coordinate type',[['number','Numeric'],['date','Date / time'],['category','Categories']],mapping.xKind)}
      ${count?'<p class="editor-hint">Count rows for each coordinate, optionally split by another column.</p>':`
      <fieldset class="figure-value-columns"><legend>Numeric measures</legend>${measures.map(column=>{
        const chosen=mapping.values.find(v=>v.column===column.index);
        return `<div class="figure-value-choice"><label class="figure-column-check"><input type="checkbox" data-import-value="${column.index}" ${chosen?'checked':''}><span>${esc(column.label)}<small>${kindLabel[column.kind]}</small></span></label>
         ${chosen&&(mapping.operation??'raw')==='raw'?`<label class="figure-error-column">Uncertainty for ${esc(column.label)}<select data-import-error="${column.index}">${options([['','None'],...measures.filter(c=>c.index!==column.index).map(c=>[c.index,c.label])],chosen.error??'')}</select></label><div data-import-interval-owner="${column.index}">${intervalMappingControls(columns,{esc,attribute:'data-import-interval',values:chosen}).replace(/<label>[^]*?<\/label>/,'')}${markerMapping(columns,esc,chosen.count)}</div>`:''}</div>`;
      }).join('')||'<p>No numeric measures. Choose Count rows to summarize this table.</p>'}</fieldset>`}
      ${select('group','Split series by',[['','No grouping'],...choices.filter(([index])=>index!==mapping.x)],mapping.group??'')}
      ${select('kind','Imported plot type',FIGURE_TYPES,mapping.kind)}
      ${['line','area'].includes(mapping.kind)&&mapping.xKind!=='category'?select('order','Connect measurements in',[['source','File order'],['ascending','Coordinate order (ascending)']],mapping.order):''}
      <details class="figure-category-roles"><summary>Use categories &amp; dates</summary>
       <p class="editor-hint">Text describes categories; dates position measurements in time. Use them as coordinates, groups or row counts.</p>
       ${categories.map(column=>`<div class="figure-category-role"><strong>${esc(column.label)}</strong><small>${kindLabel[column.kind]}</small><div>
        ${button('axis','Coordinate',`data-column="${column.index}" aria-label="Use ${esc(column.label)} as coordinate"`)}
        ${button('group','Group',`data-column="${column.index}" aria-label="Group by ${esc(column.label)}" ${column.index===mapping.x?'disabled':''}`)}
        ${button('count','Count',`data-column="${column.index}" aria-label="Count rows by ${esc(column.label)}"`)}
       </div></div>`).join('')}
      </details>
      <details class="figure-import-design"><summary>Customize graph &amp; text</summary><div data-import-design>${designPanel(state)}</div></details>
     </div>
     <div class="figure-import-review">
      <div class="figure-import-section-title"><strong>Proposed figure</strong><span>Not applied yet</span></div>
      <div class="figure-import-plot"></div>
      ${candidate.measurements>2000?'<p class="editor-hint">Preview shows up to 2,000 measurements. All mapped rows will be imported.</p>':''}
      ${candidate.issues.length?`<div class="figure-import-problems" role="alert"><strong>Check the selected columns</strong><ul>${candidate.issues.slice(0,6).map(issue=>'<li>'+esc(issueText(issue))+'</li>').join('')}</ul>${candidate.issues.length>6?'<p>'+(candidate.issues.length-6)+' more issues in the selected columns.</p>':''}</div>`:''}
      ${candidate.warnings.length?'<div class="figure-import-warnings">'+candidate.warnings.map(message=>'<p>'+esc(message)+'</p>').join('')+'</div>':''}

     </div>
    </div>
    <p class="editor-hint figure-import-note">${candidate.figure?.summary?esc(figureSummary(candidate.figure)):'Individual measurements retain their original values. Choose a summary explicitly to combine rows.'}</p>
    <footer class="figure-import-footer">
     ${select('mode','Apply to this figure',[['replace','Replace series'],...((mapping.operation??'raw')==='raw'&&!figure.summary?[['append','Add as new series']]:[])],mapping.mode)}
     <div><p role="status">${ready?candidate.measurements+' values in '+candidate.seriesCount+' series ready.':'Choose the data roles before importing.'}</p>
     ${button('apply',mapping.mode==='append'?'Add mapped series':'Use mapped data',ready?'':'disabled')}</div>
    </footer>`;
  }
  function view(figure) {
    const state = session(figure.id);
    return `<details class="figure-import" ${state.open ? 'open' : ''}><summary>Import or paste data</summary>
      <div class="figure-import-section-title"><p class="editor-hint">Choose columns and review the graph before applying.</p><button type="button" class="button" data-action="figure-expand">Expand editor</button></div>
      <details class="figure-import-source" ${state.sourceOpen ? 'open' : ''}><summary data-import-source-label>${state.table ? esc(state.name || 'Pasted data') + ' · ' + state.table.rows.length + ' rows' : 'Choose a file or paste a table'}</summary>
        <label class="figure-file-picker button"><span>Choose CSV / TSV file</span><input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" data-figure-file aria-label="Open CSV / TSV"></label>
        <span data-import-filename>${esc(state.name)}</span>
        <label>Data to import<textarea rows="4" data-figure-paste placeholder="Paste a table from a spreadsheet or a CSV file">${esc(state.source)}</textarea></label>
        <div class="figure-source-options">
          <label>Column separator<select data-import-source="delimiter">${options(TABLE_DELIMITERS, state.delimiter)}</select></label>
          <label>Decimal separator<select data-import-source="decimal">${options([['.','Dot (3.14)'], [',','Comma (3,14)']], state.decimal)}</select></label>
          <label class="figure-column-check"><input type="checkbox" data-import-source="header" ${state.header ? 'checked' : ''}>First row contains column names</label>
          ${button('review', 'Review data')}
        </div>
      </details>
      <p class="figure-import-problems" data-figure-import-error role="alert">${esc(state.error)}</p>
      <div data-figure-mapping>${mappingView(state, figure)}</div>
    </details>`;
  }
  function mappingUpdate(host, state, figure, target) {
    state.tableOpen=host.querySelector('.figure-source-table')?.open??state.tableOpen;
    const designOpen=host.querySelector('.figure-import-design')?.open??false;
    const rolesOpen=host.querySelector('.figure-category-roles')?.open??false;
    const selector = target?.dataset.importMap !== undefined ? '[data-import-map="' + target.dataset.importMap + '"]'
      : target?.dataset.importValue !== undefined ? '[data-import-value="' + target.dataset.importValue + '"]'
      : target?.dataset.importError !== undefined ? '[data-import-error="' + target.dataset.importError + '"]' : null;
    host.querySelector('[data-figure-mapping]').innerHTML = mappingView(state, figure);
    const table = host.querySelector('.figure-source-table');
    if (table) table.open=state.tableOpen;
    const design=host.querySelector('.figure-import-design');if(design)design.open=designOpen;
    const roles=host.querySelector('.figure-category-roles');if(roles)roles.open=rolesOpen;
    paint(host,state,figure);
    if (selector) host.querySelector(selector)?.focus({preventScroll:true});
    host.querySelector('[data-figure-import-error]').textContent = state.error;
  }
  function remember(host, state) {
    state.open = host.querySelector('.figure-import').open;
    state.sourceOpen = host.querySelector('.figure-import-source').open;
  }
  function review(host, state, figure, collapse = true) {
    try {
      const table = readDelimitedTable(state.source, {delimiter:state.delimiter, header:state.header});
      const sameColumns = state.table && JSON.stringify(state.table.columns) === JSON.stringify(table.columns);
      state.mapping = sameColumns ? {...state.mapping, decimal:state.decimal} : suggestFigureMapping(table, figure, state.decimal);
      state.table = table; state.error = ''; state.stale = false; state.page = 0;
      state.sourceOpen = !collapse; state.open = true;
      host.querySelector('.figure-import-source').open = !collapse;
      host.querySelector('[data-import-source-label]').textContent = (state.name || 'Pasted data') + ' · ' + table.rows.length + ' rows';
    } catch (error) { state.error = error.message; state.stale = true; }
    mappingUpdate(host, state, figure);
  }
  function input(target, figure, host) {
    const state = session(figure.id);
    if (!target.closest('.figure-import')) return false;
    remember(host,state);
    const design=figureDesignInput(target);
    if(design&&state.candidate?.figure){
      const values=design.key===undefined?state.design.fields:(state.design.series[design.key]??={});
      values[design.path]=design.value;
      setFigureDesign(state.candidate.figure,design.path,design.value,design.key===undefined?null:state.seriesKeys.indexOf(design.key));
      paint(host,state,figure);
      const apply=host.querySelector('[data-action="figure-import-apply"]');
      if(apply)apply.disabled=figureIssues(state.candidate.figure).length>0;
      return true;
    }
    if(target.matches('[data-import-column-search]')){
      state.columnSearch=target.value;state.tableOpen=true;
      const selection=target.selectionStart;
      host.querySelector('.figure-source-table').outerHTML=mappedTable(state,state.candidate);
      const input=host.querySelector('[data-import-column-search]');input.focus({preventScroll:true});input.setSelectionRange(selection,selection);
      return true;
    }
    if(target.matches('[data-import-column-jump]')){
      if(target.value==='')return true;
      const column=target.value;state.columnSearch='';state.tableOpen=true;
      host.querySelector('.figure-source-table').outerHTML=mappedTable(state,state.candidate);
      const cell=host.querySelector('[data-source-column="'+column+'"]'),scroll=host.querySelector('.figure-source-table .table-scroll');
      scroll.scrollLeft+=cell.getBoundingClientRect().left-scroll.getBoundingClientRect().left-scroll.querySelector('th').offsetWidth;
      host.querySelector('[data-import-column-jump]').value=column;
      host.querySelector('[data-import-column-jump]').focus({preventScroll:true});
      return true;
    }
    if (target.matches('[data-figure-paste]')) {
      state.source = target.value; state.name = ''; state.stale = true; state.error = ''; state.version++;
      host.querySelector('[data-import-filename]').textContent = '';
      mappingUpdate(host, state, figure);
    } else if (target.matches('[data-figure-file]')) {
      const file = target.files[0]; if (!file) return true;
      const version = ++state.version; state.stale = true; state.error = '';
      mappingUpdate(host, state, figure);
      (async () => {
        if (file.size > MAX_TABLE_TEXT) throw new Error('Choose a CSV or TSV file up to 16 MiB.');
        const source = await file.text();
        if (state.version !== version || !host.isConnected || getFigure(figure.id) !== figure) return;
        state.source = source; state.name = file.name;
        host.querySelector('[data-figure-paste]').value = source;
        host.querySelector('[data-import-filename]').textContent = file.name;
        review(host, state, figure);
      })().catch(error => {
        if (state.version !== version || !host.isConnected) return;
        state.error = error.message; mappingUpdate(host, state, figure);
      });
    } else if (target.dataset.importSource) {
      const key = target.dataset.importSource;
      state[key] = target.type === 'checkbox' ? target.checked : target.value;
      state.version++;
      if (state.source.trim()) review(host, state, figure, false);
    } else if (target.dataset.importMap) {
      const key = target.dataset.importMap;
      state.mapping[key] = key === 'x' ? Number(target.value) : key === 'group' ? target.value === '' ? null : Number(target.value) : target.value;
      if (key === 'x') {
        const profile = figureColumns(state.table, state.decimal)[state.mapping.x];
        if(state.mapping.group===state.mapping.x)state.mapping.group=null;
        state.mapping.xKind = profile.kind === 'number' ? 'number' : profile.kind === 'date' ? 'date' : 'category';
      }
      if(key==='operation'&&state.mapping.operation!=='raw'){state.mapping.mode='replace';state.mapping.kind=state.mapping.xKind==='category'?'bar-horizontal':'bar';}
      mappingUpdate(host, state, figure, target);
    } else if (target.dataset.importValue !== undefined) {
      const column = Number(target.dataset.importValue);
      if (target.checked) state.mapping.values.push({column, error:null});
      else state.mapping.values = state.mapping.values.filter(value => value.column !== column);
      mappingUpdate(host, state, figure, target);
    } else if(target.matches('[data-marker-count-column]')){const column=Number(target.closest('[data-import-interval-owner]').dataset.importIntervalOwner),chosen=state.mapping.values.find(v=>v.column===column);chosen.count=target.value===''?null:Number(target.value);mappingUpdate(host,state,figure);
    } else if (target.dataset.importInterval !== undefined) {
      const column=Number(target.closest('[data-import-interval-owner]').dataset.importIntervalOwner),chosen=state.mapping.values.find(v=>v.column===column);chosen[target.dataset.importInterval]=target.value===''?null:Number(target.value);mappingUpdate(host,state,figure);const field=host.querySelector('[data-import-interval-owner="'+column+'"] [data-import-interval="'+target.dataset.importInterval+'"]');if(field){field.closest('details').open=true;field.focus({preventScroll:true});}
    } else if (target.dataset.importError !== undefined) {
      const selected = state.mapping.values.find(value => value.column === Number(target.dataset.importError));
      selected.error = target.value === '' ? null : Number(target.value);
      mappingUpdate(host, state, figure, target);
    } else return false;
    return true;
  }
  function action(target, figure, host) {
    const name = target.dataset.action;
    if(name==='figure-design-tab'&&target.closest('.figure-import')){
      const state=session(figure.id);state.designTab=target.dataset.tab;
      host.querySelector('[data-import-design]').innerHTML=designPanel(state);return true;
    }
    if (!name?.startsWith('figure-import-')) return false;
    const state = session(figure.id); remember(host, state);
    if(['figure-import-axis','figure-import-group','figure-import-count'].includes(name)){
      const column=Number(target.dataset.column),profile=figureColumns(state.table,state.decimal)[column];
      if(name==='figure-import-group'){
        if(state.mapping.x!==column)state.mapping.group=column;
      }else{
        state.mapping.x=column;state.mapping.xKind=profile.kind==='date'?'date':profile.kind==='number'?'number':'category';
        if(state.mapping.group===column)state.mapping.group=null;
        if(name==='figure-import-count'){state.mapping.operation='count';state.mapping.xKind='category';state.mapping.mode='replace';}
        if(state.mapping.xKind==='category')state.mapping.kind='bar-horizontal';
      }
      mappingUpdate(host,state,figure);
    }
    else if (name === 'figure-import-review') review(host, state, figure);
    else if (name === 'figure-import-apply') {
      const candidate = result(state, figure);
      if (candidate?.figure&&!candidate.issues.length) {
        sessions.delete(figure.id);
        apply(figure, candidate.figure);
      }
    } else if (name === 'figure-import-next' || name === 'figure-import-previous') {
      const step = name.endsWith('next') ? 1 : -1;
      state.page = Math.max(0, Math.min(Math.ceil(state.table.rows.length / pageSize) - 1, state.page + step));
      mappingUpdate(host, state, figure, target);
    }
    return true;
  }
  function capture(host) {
    const id = host?.dataset.figureId;
    if (id && sessions.has(id)) remember(host, sessions.get(id));
  }
  return {view, input, action, capture, bind(host,figure){const state=sessions.get(figure.id);if(state?.table&&!state.stale){result(state,figure);paint(host,state,figure);}}, update(host, figure) {
    const state = sessions.get(figure.id);
    if (state?.table && !state.stale) mappingUpdate(host, state, figure);
  }, forget:id => sessions.delete(id)};
}
