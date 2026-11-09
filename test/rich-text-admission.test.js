import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {plainRichText,richTextAdmission,validRichText,RICH_TEXT_LIMITS} from '../src/web/rich-text-model.js';
import {bookBlockText,BOOK_TABLE_LIMITS} from '../src/web/book-blocks.js';
import {splitWritingSections} from '../src/web/rich-text-sections.js';

test('reports the limiting dimension at each admitted writing boundary',()=>{
 const {characters,nodes,depth}=RICH_TEXT_LIMITS;
 const full=plainRichText('𐌀'.repeat(characters/2)),admitted=richTextAdmission(full);
 assert.deepEqual(admitted,{valid:true,issue:null,characters,nodes:3,depth:2});
 full.content[0].content[0].text+='a';assert.deepEqual(richTextAdmission(full).issue,{dimension:'characters',limit:characters});
 const parts={type:'doc',content:Array.from({length:nodes-1},()=>({type:'paragraph'}))};
 assert.equal(richTextAdmission(parts).valid,true);parts.content.push({type:'paragraph'});assert.deepEqual(richTextAdmission(parts).issue,{dimension:'nodes',limit:nodes});
 let branch={type:'paragraph'};for(let i=1;i<depth;i++)branch={type:'blockquote',content:[branch]};
 assert.equal(richTextAdmission({type:'doc',content:[branch]}).valid,true);
 assert.deepEqual(richTextAdmission({type:'doc',content:[{type:'blockquote',content:[branch]}]}).issue,{dimension:'depth',limit:depth});
 assert.deepEqual(richTextAdmission({type:'doc',content:[{type:'paragraph',attrs:{unknown:true}}]}).issue,{dimension:'structure'});
});

test('splitting leaves scientific block identities, marked text and Unicode scalar pairs intact',()=>{
 const heading={type:'heading',attrs:{id:randomUUID(),level:2},content:[{type:'text',text:'A'}]};
 const mark={type:'strong'},paragraph={type:'paragraph',content:[{type:'text',marks:[mark],text:'1234𝄞56'}]};
 const parts=splitWritingSections([heading,paragraph],5);
 assert.deepEqual(parts.map(doc=>doc.content.map(n=>n.content[0].text)),[['A','1234'],['𝄞56']]);
 assert.equal(parts[0].content[0],heading);
 for(const part of parts){assert.equal(validRichText(part,{maxCharacters:5}),true);assert.equal(part.content.at(-1).content[0].marks[0],mark);}
 assert.equal(splitWritingSections([{type:'heading',attrs:{id:randomUUID(),level:2},content:[{type:'text',text:'Too long'}]}],4),null);
 assert.equal(splitWritingSections(plainRichText('𝄞').content,1),null);
});

test('scientific table accounting agrees with the saved text including empty cells and real line breaks',()=>{
 const table={type:'book_table',attrs:{id:randomUUID(),version:1,title:'Measurements',headers:['Station','Value'],rows:[['α',''],['','2\n3']]}};
 const doc={type:'doc',content:[table]},length=bookBlockText(table).length;
 assert.equal(richTextAdmission(doc).characters,length);
 assert.equal(validRichText(doc,{maxCharacters:length}),true);
 assert.deepEqual(richTextAdmission(doc,{maxCharacters:length-1}).issue,{dimension:'characters',limit:length-1});
 const check=(attrs,dimension,limit)=>assert.deepEqual(richTextAdmission({type:'doc',content:[{...table,attrs:{...table.attrs,...attrs}}]}).issue,{dimension,limit});
 check({rows:Array(501).fill(['',''])},'tableRows',BOOK_TABLE_LIMITS.rows);
 check({headers:Array(21).fill('Heading')},'tableColumns',BOOK_TABLE_LIMITS.columns);
 check({headers:['a'.repeat(501),'Value']},'tableHeader',BOOK_TABLE_LIMITS.headerCharacters);
 check({rows:[['a'.repeat(10001),'']]},'tableCell',BOOK_TABLE_LIMITS.cellCharacters);
});
