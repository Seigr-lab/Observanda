import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFigure,figureIssues as modelIssues,figureCSV} from '../src/web/figure-model.js';
import {readDelimitedTable as modelTable} from '../src/web/tabular-data.js';
import {mapFigureTable as modelMapping,suggestFigureMapping} from '../src/web/figure-import-model.js';
import {createComposition} from '../src/web/figure-composition.js';
import {figureIssues,readDelimitedTable,mapFigureTable,parseFigureCSV} from '../src/web/scientific-validation.js';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';

const locales=['en','ca','es','nb','nn'];
async function language(locale){await prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});activateLanguage(locale);}
const withoutGeneratedSeriesIds=figure=>({...figure,series:figure.series.map(({id,...series})=>series)});

test('figure diagnostics translate dynamic names and nested validators while default validation stays deterministic',async context=>{
 context.after(()=>activateLanguage('en'));
 const figure=createFigure();figure.title='Authored title';figure.series[0].name='Authored {row} <name>';
 figure.series[0].points=[{x:null,y:1,error:null}];const before=structuredClone(figure),english=modelIssues(figure);
 const interval=structuredClone(figure);interval.series[0].points=[{x:1,y:1,error:null,yLower:2,yUpper:3}];
 const composition=createComposition([figure,figure]);
 for(const locale of locales){
  await language(locale);
  const expected=t('figureDiagnostics','pointCoordinate',{series:figure.series[0].name,row:1});
  assert.deepEqual(figureIssues(figure),[expected]);assert.deepEqual(figureIssues(composition),[expected,expected]);
  assert.ok(figureIssues(interval).includes(t('figureIntervals','enclose')));
  assert.deepEqual(modelIssues(figure),english);assert.deepEqual(figure,before);
  assert.deepEqual(figureIssues({...figure,title:''}),[t('figureDiagnostics','titleRequired'),expected]);
 }
});

test('table diagnostics retain line and column counts while imported text and CSV conventions stay unchanged',async context=>{
 context.after(()=>activateLanguage('en'));
 const source='Coordinate;Authored value\n1; 2\n3;',expected=modelTable(source);
 for(const locale of locales){
  await language(locale);
  assert.deepEqual(readDelimitedTable(source),expected);
  assert.throws(()=>readDelimitedTable('A,B\n1,2,3',{delimiter:','}),{message:t('figureDiagnostics','tableWidth',{line:2,found:3,expected:2})});
  assert.throws(()=>readDelimitedTable('A,B\n"unclosed,2',{delimiter:','}),{message:t('figureDiagnostics','quotedUnclosed',{line:2})});
  assert.throws(()=>modelTable('A,B\n1,2,3',{delimiter:','}),{message:'Line 2: found 3 columns; expected 2. Check the separator and quoted fields.'});
  assert.throws(()=>parseFigureCSV('X,Authored value\n1,invalid'),{message:t('figureDiagnostics','csvGap',{row:2,column:'Authored value'})});
  const figure=createFigure();figure.series[0].points=[{x:1,y:2,error:null}];
  assert.ok(figureCSV(figure).startsWith('"Series","X","Value","Uncertainty"'));
 }
});

test('import warnings and errors follow the selected language without altering calculated values or source roles',async context=>{
 context.after(()=>activateLanguage('en'));
 const table=modelTable('Category,Amount\na,2\na,4\nb,'),figure=createFigure();
 const mapping={...suggestFigureMapping(table,figure),operation:'mean',xKind:'category',kind:'bar'};
 const before=JSON.stringify({table,figure,mapping}),reference=modelMapping(table,mapping,figure);
 for(const locale of locales){
  await language(locale);
  const result=mapFigureTable(table,mapping,figure);
  assert.deepEqual(withoutGeneratedSeriesIds(result.figure),withoutGeneratedSeriesIds(reference.figure));
  assert.equal(result.warnings[0],t('figureDiagnostics','calculatedRows',{operation:t('datasetAggregation','mean'),rows:3})+' '+t('figureDiagnostics','missingExcluded',{count:1}));
  assert.deepEqual(modelMapping(table,mapping,figure).warnings,reference.warnings);
  const invalid=mapFigureTable(table,{...mapping,operation:'raw',values:[{column:0,error:null}]},figure);
  assert.equal(invalid.figure,null);assert.equal(invalid.issues[0].line,2);assert.equal(invalid.issues[0].column,0);
  assert.equal(invalid.issues[0].message,t('figureDiagnostics','numberOrGap'));
  assert.equal(JSON.stringify({table,figure,mapping}),before);
 }
});
