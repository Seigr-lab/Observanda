import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFigure} from '../src/web/figure-model.js';
import {createComposition} from '../src/web/figure-composition.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateDetachedRecords} from '../src/model.js';
import {buildPublication} from '../src/publication.js';
import {figureResultView} from '../src/web/result-statements.js';
import analyses from '../src/web/locales/en/analyses.json' with {type:'json'};

function plot(title,values=[1,4,2]){const f=createFigure();f.title=title;f.x.label='Time (s)';f.y.label='Response (V)';f.series[0].points=values.map((y,x)=>({x,y,error:.25}));return f;}
const esc=String;

test('a public figure without a supporting result carries no authoring note, while the lab book keeps it',()=>{
 const lone=plot('Swarm weight'),compound=createComposition([plot('Panel one'),plot('Panel two')]);
 assert.equal(figureResultView(lone,null,esc,{publicView:true}),'');
 assert.equal(figureResultView(compound,{version:1,statements:[]},esc,{publicView:true}),'');
 assert.match(figureResultView(lone,null,esc),new RegExp(analyses.figureUnlinked.slice(0,30).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 const book=upgradeNotebook(sampleNotebook()),record=book.entries.find(e=>e.share);
 record.figures=[lone];record.sections=[];
 record.body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Weights below.'}]},{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:lone.id,alternative:'Weight curve.'}}]};
 validateDetachedRecords([record]);
 const html=[...buildPublication(book).files.values()].map(String).join('\n');
 assert.match(html,/Swarm weight/);
 assert.ok(!html.includes(analyses.figureUnlinked),'authoring note published');
});
