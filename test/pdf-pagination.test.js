import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validPdfPagination,validPdfPaginationRule,pdfPaginationDefaults,pdfPaginationStatus,pdfPaginationItems,pdfPaginationRuleDefaults,pdfSetPaginationRule,pdfAdjustPagination} from '../src/web/pdf-pagination-model.js';
import {pdfPaginationUI} from '../src/web/pdf-pagination-ui.js';
import {applyPdfPagination} from '../src/pdf-pagination.js';
const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]}),section=()=>({id:randomUUID(),title:'Flow',content:{type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'Heading'}]},paragraph('First prose'),paragraph('Following prose')]},layout:null,start:null});
const rule=(block=1,patch={})=>({block,keepWithNext:false,keepTogether:false,widows:3,orphans:3,...patch});

test('pagination is optional, strictly typed and selected by existing prose position',()=>{
 const value=section(),html=['<h2>Heading</h2>','<p>First prose</p>','<p>Following prose</p>'];assert.equal(pdfPaginationStatus(value).ready,true);const result=applyPdfPagination(value,html);assert.equal(result.blocks,html);assert.equal(result.css,'');assert.equal(result.active,false);
 assert.deepEqual(pdfPaginationDefaults(value),{version:1,blockCount:3,rules:[]});assert.deepEqual(pdfPaginationRuleDefaults(value,0),rule(0,{keepWithNext:true}));assert.deepEqual(pdfPaginationItems(value).map(row=>row.block),[0,1,2]);
 const setting={version:1,blockCount:3,rules:[rule()]};assert.equal(validPdfPagination(setting),true);
 for(const patch of [{version:2},{blockCount:-1},{blockCount:12001},{rules:[rule(),rule()]},{rules:[rule(3)]},{unknown:true}])assert.equal(validPdfPagination({...setting,...patch}),false);
 for(const patch of [{widows:0},{widows:11},{widows:1.5},{orphans:'2'},{keepTogether:1},{keepWithNext:'avoid'},{block:NaN},{extra:true}])assert.equal(validPdfPaginationRule({...rule(),...patch}),false);
 value.content.content.push({type:'book_table',attrs:{title:'Retained table'}});assert.equal(pdfPaginationItems(value).length,3);assert.equal(pdfSetPaginationRule(value,3,{keepTogether:true}),null);
});

test('selected rule edits preserve source blocks and resetting defaults removes explicit changes',()=>{
 const value=section(),before=structuredClone(value);value.pagination=pdfSetPaginationRule(value,1,{keepTogether:true,widows:4});assert.equal(validPdfPagination(value.pagination),true);assert.deepEqual(value.content,before.content);assert.equal(value.pagination.rules.length,1);
 value.pagination=pdfSetPaginationRule(value,0,{keepWithNext:false});assert.deepEqual(value.pagination.rules.map(row=>row.block),[0,1]);const html=['<h2 id="anchor">Heading</h2>','<p>First prose</p>','<p>Following prose</p>'],rendered=applyPdfPagination(value,html);assert.equal(rendered.blocks[2],html[2]);assert.ok(rendered.blocks[0].includes(html[0]));assert.match(rendered.blocks[0],/--pdf-keep-next:auto/);assert.match(rendered.blocks[1],/--pdf-keep-together:avoid/);assert.match(rendered.blocks[1],/--pdf-widows:4/);assert.match(rendered.css,/break-after:inherit/);assert.equal(rendered.blocks.some(block=>block.includes('overflow:hidden')),false);
 value.pagination=pdfSetPaginationRule(value,0,{keepWithNext:true});assert.deepEqual(value.pagination.rules.map(row=>row.block),[1]);value.pagination=pdfSetPaginationRule(value,1,{keepTogether:false,widows:3});assert.deepEqual(value.pagination.rules,[]);assert.equal(applyPdfPagination(value,html).blocks,html);
});

test('changed content keeps its old intentions until explicit adjustment, including replaced non-prose blocks',()=>{
 const value=section();value.pagination=pdfSetPaginationRule(value,2,{keepTogether:true});const saved=structuredClone(value.pagination);value.content.content.pop();assert.equal(pdfPaginationStatus(value).stale,true);assert.deepEqual(value.pagination,saved);assert.equal(pdfSetPaginationRule(value,1,{widows:4}),null);assert.throws(()=>applyPdfPagination(value,['<h2>Heading</h2>','<p>First prose</p>']),{code:'PDF_PAGINATION_STALE'});
 value.pagination=pdfAdjustPagination(value);assert.equal(value.pagination.blockCount,2);assert.deepEqual(value.pagination.rules,[]);value.pagination=pdfSetPaginationRule(value,1,{orphans:4});value.content.content[1]={type:'horizontal_rule'};assert.equal(pdfPaginationStatus(value).stale,true);value.pagination=pdfAdjustPagination(value);assert.deepEqual(value.pagination.rules,[]);
 const invalid=section();invalid.pagination={version:1,blockCount:3,rules:[rule(1,{widows:'3;display:none'})]};assert.throws(()=>applyPdfPagination(invalid,[]),{code:'PDF_PAGINATION'});
});

test('positioned pages retain but do not apply flow controls; cancellation leaves inputs untouched',()=>{
 const value=section();value.pagination=pdfSetPaginationRule(value,1,{keepTogether:true});const saved=structuredClone(value.pagination);value.composition={mode:'page'};value.content.content.push(paragraph('New positioned item'));const html=['<div>Positioned compiled content</div>'];assert.equal(pdfPaginationStatus(value).compatible,false);assert.equal(pdfPaginationStatus(value).ready,true);assert.equal(pdfSetPaginationRule(value,1,{widows:4}),null);assert.deepEqual(applyPdfPagination(value,html),{blocks:html,css:'',active:false});assert.deepEqual(value.pagination,saved);
 delete value.composition;assert.throws(()=>applyPdfPagination(value,html),{code:'PDF_PAGINATION_STALE'});const controller=new AbortController();controller.abort();assert.throws(()=>applyPdfPagination(value,html,{signal:controller.signal}),{name:'AbortError'});assert.deepEqual(value.pagination,saved);
});

const input=(name,value,{checked=false,select=false}={})=>({dataset:select?{}:{pdfPaginationField:name},value,checked,invalid:false,hasAttribute:key=>select&&key==='data-pdf-pagination-select',setAttribute(name){if(name==='aria-invalid')this.invalid=true;},removeAttribute(name){if(name==='aria-invalid')this.invalid=false;}});
test('author controls keep numeric input stable, reject invalid values and require adjustment after structural edits',()=>{
 const value=section(),document={header:{id:randomUUID()}},original=structuredClone(document);let changes=0,draws=0;const ui=pdfPaginationUI({esc:String,getDocument:()=>document,getSection:()=>value,changed:()=>changes++,draw:()=>draws++});assert.match(ui.view(),/data-pdf-pagination-editor/);ui.input(input('', '1',{select:true}));assert.equal(draws,1);ui.input(input('widows','4'));assert.equal(changes,1);assert.equal(draws,1);assert.equal(value.pagination.rules[0].widows,4);
 const invalid=input('orphans','0');ui.input(invalid);assert.equal(invalid.invalid,true);assert.equal(changes,1);ui.input(input('keepTogether','',{checked:true}));assert.equal(value.pagination.rules[0].keepTogether,true);value.content.content.push(paragraph('New block'));ui.input(input('widows','5'));assert.equal(changes,2);ui.action('pagination-adjust');assert.equal(pdfPaginationStatus(value).stale,false);assert.equal(value.pagination.rules[0].widows,4);
 value.composition={mode:'page'};assert.match(ui.view(),/data-pdf-pagination-controls disabled/);ui.input(input('widows','5'));assert.equal(value.pagination.rules[0].widows,4);ui.action('pagination-clear');assert.equal(value.pagination,undefined);assert.deepEqual(document,original);assert.equal(ui.action('other'),false);ui.dispose();
});
