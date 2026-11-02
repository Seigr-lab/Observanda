import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {permittedFigureSVGs} from '../src/website-figure-assets.js';

test('a figure replacement uses only its own uniquely identified permitted SVG download',()=>{
 const id=randomUUID(),child=randomUUID(),denied=randomUUID(),ambiguous=randomUUID();
 const asset='assets/'+'1'.repeat(64)+'.svg',other='assets/'+'2'.repeat(64)+'.svg';
 const descriptor=name=>({name,contentType:'image/svg+xml'}),link=name=>'<a download href="'+name+'">SVG</a>';
 const section=(id,body)=>'<figure data-observanda-part="figure:'+id+'">'+body+'</figure>';
 const fragment=section(id,section(child,link(other))+link(asset))+section(denied,link('assets/'+'3'.repeat(64)+'.svg'))+section(ambiguous,link(asset))+section(ambiguous,link(other));
 const files=permittedFigureSVGs(fragment,[descriptor(asset),descriptor(other)]);
 assert.equal(files.get(id),asset);assert.equal(files.get(child),other);
 assert.equal(files.get(denied),null);assert.equal(files.get(ambiguous),null);
 assert.equal(files.has(randomUUID()),false);
});
