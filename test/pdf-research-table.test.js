import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {selectPdfResearchTable,pdfResearchTableChoices,validPdfResearchTableContent} from '../src/web/pdf-research-table.js';
import {validPdfResearch,pdfResearchChanges} from '../src/web/pdf-research-model.js';
const table=(title='Exact readings')=>({type:'book_table',attrs:{version:1,id:randomUUID(),title,headers:['Label','Value'],rows:[['Trial <one>','9007199254740993'],['Trial two','0001.2300']]}});
const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]});
const capture=content=>({version:1,workspaceId:randomUUID(),snapshotId:'a'.repeat(64),recordId:randomUUID(),recordRevision:'b'.repeat(64),collection:'sections',itemId:randomUUID(),title:'Exact readings',content,figures:[]});

test('a PDF table selection retains exact nested authored values and refuses missing or ambiguous identities',()=>{
 const selected=table(),content={type:'doc',content:[paragraph('PRIVATE surrounding prose'),{type:'blockquote',content:[selected]},paragraph('PRIVATE following prose')]},before=structuredClone(content),result=selectPdfResearchTable(content,selected.attrs.id);
 assert.deepEqual(result,{type:'doc',content:[selected]});assert.deepEqual(content,before);assert.equal(validPdfResearchTableContent(result,selected.attrs.id),true);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
 result.content[0].attrs.rows[0][1]='local change';assert.equal(selected.attrs.rows[0][1],'9007199254740993');
 assert.equal(selectPdfResearchTable(content,randomUUID()),null);assert.equal(selectPdfResearchTable(content,'not-an-id'),null);assert.equal(selectPdfResearchTable({type:'doc',content:[selected,structuredClone(selected)]},selected.attrs.id),null);
 assert.equal(selectPdfResearchTable({type:'doc',content:[{...selected,attrs:{...selected.attrs,privatePath:'do not retain'}}]},selected.attrs.id),null);
});

test('PDF table choices page exact identities and labels without embedding table cells or surrounding prose',()=>{
 const tables=Array.from({length:23},(_,i)=>table('Caption '+i)),content={type:'doc',content:[paragraph('PRIVATE'),...tables]},first=pdfResearchTableChoices(content),last=pdfResearchTableChoices(content,{offset:first.next});
 assert.equal(first.total,23);assert.equal(first.items.length,20);assert.equal(first.next,20);assert.deepEqual(last,{items:tables.slice(20).map(t=>({id:t.attrs.id,title:t.attrs.title})),total:23,offset:20,next:null});assert.equal(JSON.stringify(first).includes('9007199254740993'),false);
 assert.throws(()=>pdfResearchTableChoices(content,{limit:21}),TypeError);
});

test('table provenance admits only one matching table while later document edits remain reviewable',()=>{
 const selected=table(),content={type:'doc',content:[selected]},research={...capture(content),blockId:selected.attrs.id};assert.equal(validPdfResearch(research),true);assert.equal(validPdfResearch(capture('Legacy prose')),true);
 for(const bad of [{...research,blockId:null},{...research,blockId:randomUUID()},{...research,collection:'figures'},{...research,content:{type:'doc',content:[paragraph('PRIVATE'),selected]}},{...research,content:{type:'doc',content:[selected,table()]}},{...research,extra:true}])assert.equal(validPdfResearch(bad),false);
 const incoming=structuredClone(research);incoming.content.content[0].attrs.rows[0][1]='9007199254740995';const section={title:research.title,content:'Locally authored explanation',figures:[],research};assert.deepEqual(pdfResearchChanges(section,incoming),{sourceChanged:true,locallyEdited:true,before:'Exact readings\nLabel\nValue\nTrial <one>\n9007199254740993\nTrial two\n0001.2300',after:'Exact readings\nLabel\nValue\nTrial <one>\n9007199254740995\nTrial two\n0001.2300',figuresChanged:false});
});
