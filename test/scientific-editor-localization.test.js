import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseFragment} from 'parse5';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {figureEditor} from '../src/web/figure-editor.js';
import {figureDesignView} from '../src/web/figure-design-ui.js';
import {figureImportUI} from '../src/web/figure-import-ui.js';
import {createFigure,FIGURE_TYPES} from '../src/web/figure-model.js';
import {FIGURE_OPERATIONS} from '../src/web/figure-import-model.js';
import {TABLE_DELIMITERS} from '../src/web/tabular-data.js';
import {figureTypeOptions,figureOperationOptions,tableDelimiterOptions,graphOptionText} from '../src/web/scientific-editor-text.js';
import '../src/web/dataset-calculation-graph-ui.js';

const locales=['en','ca','es','nb','nn'];
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const descendants=node=>(node.childNodes??[]).flatMap(child=>[child,...descendants(child)]);
const attr=(node,key)=>node.attrs?.find(item=>item.name===key)?.value;
const optionValues=(html,attribute,value)=>{const tree=parseFragment(html),select=descendants(tree).find(node=>node.tagName==='select'&&attr(node,attribute)===value);return descendants(select).filter(node=>node.tagName==='option').map(node=>attr(node,'value'));};

test('figure controls translate on each render, escape labels, and preserve authored figures and option identifiers',async context=>{
 const previousObserver=globalThis.ResizeObserver;globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
 context.after(()=>{globalThis.ResizeObserver=previousObserver;activateLanguage('en');});
 const figure=createFigure();figure.title='Authored <img src=x> & 105₆';figure.series[0].name='Series <script> & "one"';figure.series[0].points=[{x:1,y:2,error:null}];
 const saved=structuredClone(figure),types=structuredClone(FIGURE_TYPES),operations=structuredClone(FIGURE_OPERATIONS),delimiters=structuredClone(TABLE_DELIMITERS);
 const editor=figureEditor({getFigures:()=>[figure],changed(){},notify(){},context:()=>null});
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  const html=editor.view();
  assert.ok(html.includes(esc(t('scientificEditors','addMeasurement'))));
  assert.ok(html.includes('aria-label="'+esc(t('scientificEditors','removeMeasurement',{position:1}))+'"'));
  assert.ok(html.includes(esc(figure.title)));assert.ok(!html.includes('<img src=x>'));
  assert.deepEqual(optionValues(html,'data-figure-field','kind'),FIGURE_TYPES.map(([id])=>id));
  for(const tab of ['text','appearance','series']){
   const design=figureDesignView(figure,{tab});
   assert.ok(design.includes('aria-label="'+esc(t('scientificEditors','graphPresentation'))+'"'));
   assert.ok(!design.includes('<script>'));assert.ok(!design.includes('&amp;lt;'));
   assert.ok(!design.includes('${esc('));
  }
  assert.deepEqual(figureTypeOptions(FIGURE_TYPES).map(([id])=>id),types.map(([id])=>id));
  assert.deepEqual(figureOperationOptions(FIGURE_OPERATIONS).map(([id])=>id),operations.map(([id])=>id));
  assert.deepEqual(tableDelimiterOptions(TABLE_DELIMITERS).map(([id])=>id),delimiters.map(([id])=>id));
  assert.deepEqual(figure,saved);
 }
 assert.deepEqual(FIGURE_TYPES,types);assert.deepEqual(FIGURE_OPERATIONS,operations);assert.deepEqual(TABLE_DELIMITERS,delimiters);
});

test('import review translates column roles, counts and accessible actions while keeping source cells intact',async context=>{
 context.after(()=>activateLanguage('en'));
 const figure=createFigure(),saved=structuredClone(figure),source='<img src=x>\tMeasured & value\n1\t2\n2\t4';
 const controls=new Map(['.figure-import','.figure-import-source','.figure-source-table','.figure-import-design','.figure-category-roles','[data-figure-mapping]','[data-figure-import-error]','[data-import-filename]','[data-import-source-label]'].map(key=>[key,{open:false,innerHTML:'',textContent:''}]));
 const host={querySelector:selector=>controls.get(selector)??null};
 const importer=figureImportUI({getFigure:()=>figure,apply(){},previews:{release(){},mount(){}}});
 const paste={value:source,closest:()=>host,matches:selector=>selector==='[data-figure-paste]'};
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  importer.input(paste,figure,host);
  importer.action({dataset:{action:'figure-import-review'}},figure,host);
  const html=importer.view(figure);
  assert.ok(html.includes(esc(t('scientificEditors','sourceSize',{columns:2,rows:2}))));
  assert.ok(html.includes(esc(t('scientificEditors','readyValues',{values:2,series:1}))));
  assert.ok(html.includes('aria-label="'+esc(t('scientificEditors','importPreview'))+'"'));
  assert.ok(html.includes(esc(source)));assert.ok(!html.includes('<img src=x>'));assert.ok(!html.includes('&amp;lt;'));
  assert.deepEqual(optionValues(html,'data-import-map','operation'),FIGURE_OPERATIONS.map(([id])=>id));
  assert.deepEqual(optionValues(html,'data-import-source','delimiter'),TABLE_DELIMITERS.map(([id])=>id));
  assert.deepEqual(figure,saved);
 }
});

test('graph display options translate every operation family without altering scientific identifiers',async context=>{
 context.after(()=>activateLanguage('en'));
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  for(const [kind,values]of Object.entries({scalar:['copy','add','subtract','multiply','divide','choose','quotient','remainder','floor','ceiling','power'],interval:['bounds','lower','upper','add','subtract','multiply','divide'],clock:['ticks','interval','status'],window:['lag','lead','sum','mean','min','max','count'],'domain-arithmetic':['add','subtract','dot','matmul','multiply','divide'],domain:['copy','choose','extract'],'clock-synchronize':['value','status']})){
   for(const value of values){const label=graphOptionText('operation',value,kind);assert.ok(typeof label==='string'&&label.length);assert.ok(!label.startsWith('['),kind+':'+value);}
  }
  assert.equal(graphOptionText('representation','radix','constant'),t('measurements','radixLabel'));
  assert.equal(graphOptionText('outside','error','clock-synchronize'),t('scientificEditors','stopError'));
  assert.equal(graphOptionText('semantics','domain'),t('scientificEditors','domainMatch'));
 }
});
