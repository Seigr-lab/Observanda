import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {localizedRecordPage} from '../src/website-record-language.js';
import {retainedTableWindowHTML} from '../src/publication-retained-tables.js';
import {figureReadingView} from '../src/web/figure-reading-view.js';

const id='a'.repeat(64),rev='b'.repeat(64);
const nb=async name=>JSON.parse(await readFile(new URL('../src/web/locales/nb/'+name+'.json',import.meta.url),'utf8'));
const page=(lang,body)=>'<!doctype html><html lang="'+lang+'"><head><title>T</title></head><body><main><section data-observanda-source="'+id+'" data-observanda-source-revision="'+rev+'">'+body+'</section></main></body></html>';
const table={rows:Array.from({length:25},()=>({})),headers:['a','b','c','d']};
const numbers=value=>new Intl.NumberFormat('nb').format(value);

test('a published retained table names its rows and columns in the page language and locale',()=>{
 const block={offset:1199,columnOffset:0};
 const english=retainedTableWindowHTML(block,table);
 assert.match(english,/>Rows 1200–1224; columns 1–4<\/p>$/);
 const html=localizedRecordPage(page('nb',english));
 assert.ok(html.includes('>Rader '+numbers(1200)+'–'+numbers(1224)+'; kolonner 1–4</p>'),html);
 assert.notEqual(numbers(1200),'1200');
 assert.ok(!html.includes('Rows'));
 // Outside placed lab book material the page is never rewritten.
 const outside=localizedRecordPage('<!doctype html><html lang="nb"><head><title>T</title></head><body>'+english+'</body></html>');
 assert.ok(outside.includes('>Rows 1200–1224; columns 1–4</p>'));
});

test('table words, interval wording and figure regions follow the page language',async()=>{
 const tables=await nb('retainedTables'),measurements=await nb('measurements'),book=await nb('book');
 const body='<table><tr><th scope="col"><span data-observanda-label="retainedTables:exclusion">Exclusion</span></th><th>v (<span data-observanda-format="retainedTables:base" data-observanda-args="{&quot;radix&quot;:&quot;16&quot;}">base 16</span>)</th></tr>'+
  '<tr><td><span data-observanda-label="retainedTables:missing">Missing</span></td><td>2 [<span data-observanda-label="measurements:intervalMethod">Interval method</span>: t; <span data-observanda-label="measurements:intervalNoCoverage">no statistical coverage declared</span>]</td></tr></table>'+
  figureReadingView('<img alt="Growth">','Growth & yield');
 const html=localizedRecordPage(page('nb',body));
 assert.ok(html.includes('>'+tables.exclusion+'</span>'));
 assert.ok(html.includes('>'+tables.base.replace('{radix}','16')+'</span>'));
 assert.ok(html.includes('>'+tables.missing+'</span>'));
 assert.ok(html.includes('>'+measurements.intervalMethod+'</span>'));
 assert.ok(html.includes('>'+measurements.intervalNoCoverage+'</span>'));
 assert.ok(html.includes('aria-label="'+book.figureViewport+' Growth &amp; yield"'),html);
});
