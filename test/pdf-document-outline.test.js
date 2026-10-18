import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {compilePdfDocument} from '../src/pdf-document-renderer.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {pdfStructureDefaults} from '../src/web/pdf-structure-model.js';
import {researchReference} from '../src/web/research-reference.js';
const header=()=>({version:1,id:randomUUID(),name:'Structured report',language:'en',direction:'ltr',layout:pdfLayoutPreset(),structure:{...pdfStructureDefaults(),contents:true,numberSections:true}});
const section=(title,content='',level=1)=>({id:randomUUID(),title,content,level,layout:null,start:null});
const linked=(text,href)=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text,marks:[{type:'link',attrs:{href,title:'',target:'_self',nofollow:false}}]}]}]});
test('document contents and numbered nested headings retain semantic destinations across source references',async()=>{
 const h=header(),target=section('Conditions','Retained condition',2),origin={version:1,workspaceId:randomUUID(),snapshotId:'a'.repeat(64),recordId:randomUUID(),recordRevision:'b'.repeat(64),collection:'sections',itemId:randomUUID(),title:target.title,content:target.content,figures:[]};target.research=origin;
 const href=researchReference({workspaceId:origin.workspaceId,id:origin.recordId,kind:'record',revision:origin.recordRevision,selector:{version:1,kind:'section',id:origin.itemId}}),intro=section('Methods',linked('See conditions',href));
 const output=await compilePdfDocument(h,[intro,target]);assert.match(output.html,/<h1>1 Methods<\/h1>/);assert.match(output.html,/<h2>1.1 Conditions<\/h2>/);assert.ok(output.html.includes('href="#pdf-section-'+target.id+'"'));assert.ok(!output.html.includes('observanda://'));assert.match(output.html,/<nav class="pdf-contents /);
 await assert.rejects(compilePdfDocument(h,[intro]),{code:'PDF_UNRESOLVED_REFERENCE'});h.structure.internalLinks=false;const disabled=await compilePdfDocument(h,[intro]);assert.ok(!disabled.html.includes('<a '));assert.match(disabled.html,/See conditions/);
});
test('printed URL citations remain visible with all links disabled and figure clip destinations stay valid',async()=>{
 const h=header();h.layout.links='disabled';h.structure.printUrls=true;const output=await compilePdfDocument(h,[section('References',linked('Reference','https://example.org/study'))]);assert.ok(!output.html.includes('<a '));assert.match(output.html,/Reference \(https:\/\/example.org\/study\)/);assert.ok(output.glyphs.atkinson.includes('h'.codePointAt(0)));
});
