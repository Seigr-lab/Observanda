import {test} from 'node:test';
import assert from 'node:assert/strict';
import {csvCell,csvCellChunks} from '../src/web/csv-cell.js';
import {createFigure,figureCSV} from '../src/web/figure-model.js';
import {richFigureCSV} from '../src/web/figure-rich-export.js';
import {heatmapCSV} from '../src/web/figure-heatmap-export.js';
import {defaultHeatmap} from '../src/web/figure-heatmap.js';
import {readDelimitedTable} from '../src/web/tabular-data.js';
const collect=async values=>(await Array.fromAsync(values)).join('');
const markers=['=1+1','+SUM(1,2)','-1','@SUM(1)','\t=1','\r=1','\n=1','  =1','\ufeff=1','\u200b=1','\u00a0=1','\uff1d1','\u{e0001}=1'];

test('CSV text cells are inert across empty and UTF-16 chunk boundaries while numeric negatives survive',async()=>{
 for(const value of [...markers,'plain "quoted", text','',-1,-0,1.25,null,true]){
  const expected=csvCell(value),chunks=typeof value==='string'?Array.from({length:value.length},(_,i)=>value[i]):[String(value??'')];
  assert.equal(await collect(csvCellChunks(['',...chunks,''],{text:typeof value==='string'})),expected);
  if(typeof value==='string'&&markers.includes(value))assert.ok(expected.startsWith('"\''));
 }
 assert.equal(csvCell(-1),'"-1"');assert.equal(csvCell('-1'),'"\'-1"');
 let visited=0;const stream=csvCellChunks((async function*(){yield ' ';for(let i=0;i<10000;i++){visited++;yield ' ';}yield '=1';})());
 assert.equal((await stream.next()).value,'"');assert.equal((await stream.next()).value,"'");assert.equal(visited,0);await stream.return();
});

test('ordinary, rich and heatmap figure CSV encode formula labels as text and preserve numeric data',()=>{
 for(const name of markers){
  const f=createFigure();f.title=name;f.x.label=name;f.series[0].name=name;f.series[0].points=[{x:-1,y:-2,error:null}];
  for(const encode of [figureCSV,richFigureCSV,heatmapCSV]){
   const result=encode(f),table=readDelimitedTable(result),cells=[...table.columns,...table.rows.flatMap(row=>row.cells)];
   assert.ok(cells.includes("'"+name),encode.name);assert.ok(cells.includes('-1'));assert.ok(cells.includes('-2'));if(name!=='-1')assert.ok(!cells.includes(name),encode.name);
  }
  f.kind='heatmap';f.heatmap=defaultHeatmap();f.heatmap.thresholds[0].label=name;
  assert.ok(readDelimitedTable(figureCSV(f)).rows.some(row=>row.cells.includes("'"+name)));
 }
});
