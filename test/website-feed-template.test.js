import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWebsiteFeedTemplate,feedContentAtPage} from '../src/website-feed-template.js';
import {parseFragment} from 'parse5';
import {attr,descendants,words} from '../src/website-migration-views.js';

const row={title:'CO < Co',displayDate:'2026-02-09',recordType:'analysis',tags:['CO','Cr, Ni','A & B']};
const asset='assets/'+'a'.repeat(64)+'.png';
test('an author item layout binds literal metadata without reading the source fragment',()=>{
 const compiled=compileWebsiteFeedTemplate('<article id="card" class="sample"><h3 data-feed-field="title"></h3><time data-feed-field="date"></time><p data-feed-field="type"></p><ul data-feed-field="tags"></ul><a href="#card">Up</a></article>');
 assert.equal(compiled.needsContent,false);
 const rendered=compiled.render({row,page:'archive/notes.html',instance:'test-1',get html(){throw Error('Unexpected source read');}});
 assert.match(rendered,/CO &lt; Co/);assert.match(rendered,/<li>CO<\/li><li>Cr, Ni<\/li><li>A &amp; B<\/li>/);assert.match(rendered,/2026-02-09/);assert.match(rendered,/analysis/);
 const nodes=[...descendants(parseFragment(rendered))];assert.equal(attr(nodes.find(n=>n.tagName==='a'),'href'),'#'+attr(nodes.find(n=>n.tagName==='article'),'id'));
});
test('each repetition resolves its own anchors, accessible references, scientific graphics and nested assets',()=>{
 const layout=compileWebsiteFeedTemplate('<section><h2 data-feed-field="title"></h2><div data-feed-field="content"></div><article data-feed-field="content"></article></section>');
 const html='<section data-observanda-part="title"><h2>CO &lt; Co</h2></section><section id="one"><h3 id="name">Method</h3><p aria-labelledby="name"><a href="#one">Within entry</a><img src="'+asset+'" alt="Trace"></p><svg><defs><clipPath id="plot"></clipPath></defs><path clip-path="url(#plot)"></path></svg></section>';
 const root=parseFragment(layout.render({row,html,page:'pages/lab/archive.html',instance:'one'})),nodes=[...descendants(root)];
 const ids=nodes.map(n=>attr(n,'id')).filter(Boolean);assert.equal(ids.length,6);assert.equal(new Set(ids).size,6);
 assert.equal((words(root).match(/CO < Co/g)??[]).length,1);
 for(const n of nodes.filter(n=>n.tagName==='img'))assert.equal(attr(n,'src'),'../../'+asset);
 for(const n of nodes.filter(n=>n.tagName==='a'))assert.ok(ids.includes(attr(n,'href').slice(1)));
 for(const n of nodes.filter(n=>n.tagName==='p'))assert.ok(ids.includes(attr(n,'aria-labelledby')));
 for(const n of nodes.filter(n=>n.tagName==='path'))assert.ok(ids.includes(attr(n,'clip-path').slice(5,-1)));
 assert.match(feedContentAtPage(html,'index.html','other'),/feed-other-content-one/);
});
test('layout admission rejects active markup, fake ownership, resource URLs and invalid slot contexts',()=>{
 for(const html of ['<script src="/api/auth"></script>','<section onclick="alert(1)" data-feed-field="title"></section>',
  '<template><p data-feed-field="title"></p></template>','<article data-observanda-source="bad"><b data-feed-field="title"></b></article>',
  '<p data-feed-field="content"></p>','<section data-feed-field="content"><em>overwritten</em></section>',
  '<img src="assets/hidden.png"><p data-feed-field="title"></p>','<span style="background:image(\'https://example.org/track\')" data-feed-field="title"></span>',
  '<a href="/api/storage" data-feed-field="title"></a>','<section data-feed-field="private-notes"></section>']){
  assert.throws(()=>compileWebsiteFeedTemplate(html),{code:'INVALID'});
 }
});

test('a scientific page repeats permitted figures, data tables and results without the surrounding entry',()=>{
 const design=compileWebsiteFeedTemplate('<article><div data-feed-field="figures"></div><div data-feed-field="tables"></div><div data-feed-field="results"></div></article>');
 const html='<section data-observanda-part="body">Unselected narrative</section><section data-observanda-part="section:abc"><h3>Observations</h3>'+
  '<figure id="emission" data-observanda-part="figure:one"><img src="'+asset+'" alt="Emission"><figcaption>Emission spectrum</figcaption></figure>'+
  '<figure data-observanda-part="media:two"><img src="'+asset+'" alt="Specimen"><figcaption>Microscope image</figcaption></figure>'+
  '<table><caption>Calibration</caption><tr><th id="measure">Depth</th><td headers="measure">3 m</td></tr></table></section>'+
  '<section data-observanda-part="results">Released result <a href="#emission">See emission</a></section><div hidden><figure data-observanda-part="figure:hidden">Withdrawn</figure></div>';
 assert.ok(design.needsContent);const output=design.render({row,page:'archives/plates.html',instance:'lab-a',html});
 assert.match(output,/Emission spectrum/);assert.match(output,/Microscope image/);assert.match(output,/\.\.\/assets\//);
 assert.match(output,/<caption>Calibration<\/caption>/);assert.match(output,/Released result/);
 const all=[...descendants(parseFragment(output))];assert.equal(attr(all.find(n=>n.tagName==='a'),'href'),'#'+attr(all.find(n=>n.tagName==='figure'),'id'));
 assert.doesNotMatch(output,/Unselected narrative|Withdrawn|<h3>Observations/);
});
test('repetition stops at the caller’s byte budget and includes multibyte text and markup',()=>{
 const design=compileWebsiteFeedTemplate('<div data-feed-field="content"></div><div data-feed-field="content"></div>');
 const entry={row,page:'index.html',instance:'plate',html:'<p>Δ</p>'},size=Buffer.byteLength(design.render(entry));
 assert.equal(Buffer.byteLength(design.render({...entry,maxBytes:size})),size);
 assert.throws(()=>design.render({...entry,maxBytes:size-1}),{code:'WEBSITE_FEED_CAPACITY'});
});
