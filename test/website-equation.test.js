import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {renderEquation} from '../src/editor/equations.js';
import {equationStructures} from '../src/web/website-equation-structures.js';
import {templateSource} from '../src/web/website-equation-math.js';
import {validateWebsiteHTML} from '../src/website-file-policy.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {Workspace} from '../src/storage.js';
import {contentBuffer} from '../src/file-content.js';
import {componentOperation} from '../src/website-component-storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';

test('equation form fields reopen nested TeX structures at their original ranges',()=>{
 const matrix=templateSource('matrix',['a','b','c','d'],2),source='\\alpha^2+\\frac{x_{i}}{\\sqrt{'+matrix+'}}';
 const parts=equationStructures(source);
 assert.deepEqual(parts.map(p=>p.kind),['power','fraction','subscript','root','matrix']);
 assert.deepEqual(parts.at(-1).values,['a','b','c','d']);assert.equal(parts.at(-1).columns,2);
 const fraction=parts[1];assert.equal(source.slice(fraction.from,fraction.to),templateSource('fraction',fraction.values));
 assert.equal(templateSource('text',['mass & charge']),'\\text{mass \\& charge}');
});
test('static MathML saves, exports and reuses across website pages with research unavailable; active foreign markup fails closed',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-equation-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await rm(root,{recursive:true,force:true,maxRetries:8});});
 const ws=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});ws.catalogue=ws.storageKind=()=>assert.fail('Equation opened research storage');
 const store=new WebsiteFileStore(ws),id=randomUUID(),source='\\frac{a_1}{\\sqrt{b^2}}';
 const fragment=renderEquation(source).replace(/^<span class="katex">|<\/span>$/g,'');
 const html='<html><body><main><figure data-website-equation>'+fragment+'<figcaption>Equation of motion</figcaption></figure></main></body></html>';
 const site=await store.create({id,name:'Science',html});
 const main=await componentOperation(store,'create',id,{name:'Reusable ratio',expectedRevision:site.site.revision,blockPath:'0/0'});
 const library=await componentOperation(store,'list',id,{expectedRevision:main.site.revision});
 const placed=await componentOperation(store,'insert',id,{expectedRevision:main.site.revision,component:library.items[0].id,position:'end'});
 const files=(await store.export(id,{expectedRevision:placed.site.revision})).files;
 assert.deepEqual([...files.keys()].sort(),['index.html','style.css']);
 const content=(await contentBuffer(files.get('index.html'))).toString();assert.equal((content.match(/<mfrac>/g)??[]).length,2);assert.ok(content.includes(source));assert.doesNotMatch(content,/<script|data-equation-source/);
 for(const attack of ['<annotation-xml encoding="text/html"><img src="secret.png"></annotation-xml>','<mi href="saved.html">x</mi>','<mtext><img src="secret.png"></mtext>','<mglyph src="secret.png"></mglyph>','<mrow onclick="alert(1)"></mrow>']){
  assert.throws(()=>validateWebsiteHTML('<figure data-website-equation><math>'+attack+'</math></figure>'),{code:'INVALID'});
 }
});
