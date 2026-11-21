import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {recordPage} from './fixtures/record-page.js';
import {pngSize} from '../src/canonical-png.js';
import {FileContent} from '../src/file-content.js';
const image=()=>({id:randomUUID(),kind:'image',caption:'A research image',alt:'A leaf',transcript:'',share:true});
test('published images carry their PNG size so browsers reserve their space before loading',()=>{
 const b=sampleNotebook(),e=b.entries[0],a=image();e.attachments=[a];const bytes=readFileSync('src/preview-assets/image.png');
 assert.deepEqual(pngSize(bytes),{width:480,height:280});assert.equal(pngSize(Buffer.from('not a picture, not a picture')),null);
 // In memory, and as streamed content that holds only its first 24 bytes.
 for(const content of [bytes,Object.assign(Object.create(FileContent.prototype),{header:bytes.subarray(0,24)})]){
  const {html}=recordPage(b,e,{mediaFiles:new Map([[a.id,{kind:'image',extension:'png',bytes:content}]])});
  assert.match(html,/<img src="[^"]*media\/[^"]+\.png" width="480" height="280" alt="A leaf" loading="lazy">/);
 }
 assert.match(readFileSync('src/web/site.css','utf8'),/:where\(img\[width\]\[height\]\)\{height:auto\}/);
});
