import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFigure} from '../src/web/figure-model.js';
import {recordFigureRenderer} from '../src/web/book-reading.js';

const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
test('mixed shared panels retain child navigation anchors only once across repeated citations',()=>{
 const retained={id:randomUUID(),kind:'retained',version:1,title:'Retained child'},inline=createFigure();inline.title='Inline child';inline.series[0].points=[{x:0,y:1,error:null}];
 const composition={id:randomUUID(),kind:'panels',title:'Shared composition',layout:{columns:2,linkX:false,linkY:false},panels:[{id:randomUUID(),label:'A',figure:retained},{id:randomUUID(),label:'B',figure:inline}]},record={id:randomUUID(),figures:[composition],results:{version:1,statements:[]},attachments:[]};
 for(const order of [[composition.id,retained.id,composition.id],[retained.id,composition.id,retained.id]]){
  const render=recordFigureRenderer(record,esc,{figureSources:false,retainedFigureAction:figure=>'<button data-shared-figure="'+figure.id+'">Read selected figure</button>'}),html=order.map(render).join('');
  for(const id of [composition.id,retained.id,inline.id])assert.equal(html.split(' id="record-figure-'+id+'"').length-1,1);
  assert.ok(html.includes('data-shared-figure="'+retained.id+'"'));assert.ok(html.includes('<svg'));assert.ok(html.includes('Retained child'));assert.ok(html.includes('Inline child'));
 }
});
