import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {createFigure} from '../src/web/figure-model.js';
import {figureTextLines} from '../src/web/retained-figure-text.js';
import {retainedFigureSVG} from '../src/web/retained-figure-svg.js';
const fixture=()=>{const values=new Map();return new RetainedFigureDocuments({readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,value)=>values.set(key,value)});};
const collect=async reader=>{const buffers=[];for await(const chunk of retainedFigureSVG(reader,{width:360}))buffers.push(Buffer.from(chunk,'utf8'));return Buffer.concat(buffers).toString('utf8');};
test('long category observations and callouts retain full identity with the legend disabled',async()=>{
 const f=createFigure();f.kind='bar';f.x.kind='category';f.legend=false;f.series[0].name='Source '+('named observation '.repeat(90))+'END-SERIES';const category='Category '+('immutable label '.repeat(90))+'END-CATEGORY';f.series[0].points=[{x:category,y:12,error:null}];f.annotations=[{id:randomUUID(),kind:'callout',seriesId:f.series[0].id,pointIndex:0,dx:24,dy:-36,label:'Full original observation',color:'#92549f',opacity:.15}];
 const documents=fixture(),reader=await documents.open(await documents.retain(f)),svg=await collect(reader);assert.equal((svg.match(/class="figure-bar"/g)??[]).length,1);assert.match(svg,/END-SERIES/);assert.match(svg,/END-CATEGORY/);assert.match(svg,/figure-annotation-key-item/);assert.equal(/\[object Object\]|undefined|NaN|Infinity|\uFFFD/u.test(svg),false,'SVG must contain no lossy object or numeric placeholders');
 const key=svg.slice(svg.indexOf('class="figure-annotation-key-item"'));assert.ok(key.includes('END-CATEGORY'),'Callout key must retain the complete category identity');
});

test('streamed figure wrapping preserves words and source characters across text chunks',async()=>{
 const source='one two three four '+('identifier'.repeat(20))+' end \u{1f41d}',descriptor={format:'figure-text',version:1,preview:'unused',characters:source.length},reader={async *textChunks(){for(let at=0;at<source.length;at+=7)yield source.slice(at,at+7);}},lines=[];for await(const line of figureTextLines(reader,descriptor,{},60,10))lines.push(line);
 assert.deepEqual(lines.slice(0,3),['one two ','three ','four ']);assert.equal(lines.join(''),source);assert.ok(lines.every(line=>line.length<=10));assert.ok(lines.some(line=>line==='identifie'));assert.ok(lines.some(line=>line.includes('end')));
});
