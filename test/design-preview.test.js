import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {buildDesignExamples,EXAMPLE_GALLERY} from '../src/design-preview.js';
import {startingAppearance} from '../src/web/themes.js';
import {verifyPublication} from '../src/publication.js';

test('startup skips specimen media and a missing example can be retried after repair',async t=>{
  const read=fs.readFile,reads=[];let videoMissing=true;
  const mocked=t.mock.method(fs,'readFile',async(file,...rest)=>{
    if(file instanceof URL&&file.pathname.includes('/preview-assets/')){
      reads.push(file.pathname.split('/').at(-1));
      if(videoMissing&&reads.at(-1)==='video.mp4')return read(new URL('missing-video.mp4',file),...rest);
    }
    return read(file,...rest);
  });
  syncBuiltinESMExports();
  try{
    const preview=await import('../src/design-preview.js?deferred-assets');
    assert.deepEqual(reads,[]);
    const appearance=startingAppearance('research');
    await assert.rejects(preview.buildDesignExamples(appearance),{code:'INSTALL_FILE_MISSING'});
    videoMissing=false;reads.length=0;
    const results=await Promise.all([preview.buildDesignExamples(appearance),preview.buildDesignExamples(appearance)]);
    assert.deepEqual(reads.sort(),['audio.wav','image.png','logo.png','video.mp4']);
    for(const {candidate} of results)verifyPublication(candidate);
  }finally{mocked.mock.restore();syncBuiltinESMExports();}
});

test('complete design gallery reuses publication styles, has working links and covers editable components',async()=>{
  for(const theme of ['research','studio']){
    const appearance=startingAppearance(theme), result=await buildDesignExamples(appearance), {candidate}=result;
    verifyPublication(candidate);assert.equal(result.defaultPage,EXAMPLE_GALLERY);
    const gallery=candidate.files.get(EXAMPLE_GALLERY);
    for(const token of ['publication-card','record-page','entry-meta','breadcrumbs','custom-logo','<table>','<audio','<video','media-figure','class="tags"','fictional sample content'])assert.ok(gallery.includes(token),token);
    assert.match(candidate.files.get('styles.css'),new RegExp('--accent:'+appearance.accent));
    for(const [name,html] of candidate.files)if(name.endsWith('.html')){
      assert.ok(html.includes('Design examples / fictional content'));
      for(const [,link] of html.matchAll(/(?:href|src)="([^"]+)"/g)){
        if(link.startsWith('https:')){assert.equal(link,'https://github.com/Seigr-lab/Observanda');continue;}
        if(!link.startsWith('#'))assert.ok(candidate.files.has(path.posix.normalize(path.posix.join(path.posix.dirname(name),link.split('#')[0]))),name+':'+link);
      }
    }
    const extensions=[...candidate.files.keys()].map(name=>path.extname(name));
    for(const ext of ['.png','.wav','.mp4','.svg'])assert.ok(extensions.includes(ext));
  }
});
