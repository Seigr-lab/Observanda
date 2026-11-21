import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {mediaFixtures,PRIVATE_MARKER} from './media-fixtures.js';
import {MediaStore} from '../src/media.js';
import {mediaToolsAvailable} from './media-tools.js';
import {Workspace,digest} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {convertPublicationRecord} from '../src/publication-conversion-render.js';
import {contentBuffer} from '../src/file-content.js';
import {testServer as startServer} from './device-fixture.js';

let available, fixtures;
before(async () => {
  available = await mediaToolsAvailable();
  if (available) fixtures = await mediaFixtures(await mkdtemp(path.join(os.tmpdir(), 'observanda-fixtures-')));
});

for (const kind of ['image', 'audio', 'video']) test(`${kind} originals survive unchanged while prepared copies are playable website copy assets`, async t => {
  if (!available) return t.skip('FFmpeg and ffprobe are required for this test.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'observanda-media-'));
  const book = sampleNotebook(), workspace = new Workspace(root); await workspace.create(book);
  const store = new MediaStore(root), asset = await store.import(fixtures[kind].bytes, kind);
  assert.equal(digest(await readFile(path.join(root, '.observanda', 'media', asset.id, 'original'))), digest(fixtures[kind].bytes));
  const prepared = await store.get(asset.id);
  assert.ok(!prepared.bytes.includes(Buffer.from(PRIVATE_MARKER)));
  if (kind === 'image') assert.ok(!prepared.bytes.includes(Buffer.from('zTXt')));
  book.entries[0].attachments.push({ ...asset, caption: 'A synthetic recording', alt: 'Test evidence', transcript: 'A synthetic sound or image.', share: true });
  const copy = await convertPublicationRecord(workspace, book, book.entries[0]);
  const bytesOf = async value => value.bytes ? Buffer.from(value.bytes) : contentBuffer(value.content);
  const assets = await Promise.all(copy.assets.map(async value => ({ path: value.path, bytes: await bytesOf(value) })));
  const media = assets.find(value => value.bytes.equals(prepared.bytes)); assert.ok(media);
  assert.ok(copy.html.includes(media.path)); assert.ok(copy.html.includes(kind === 'image' ? '<img' : `<${kind} controls`));
  assert.ok(!assets.some(value => value.bytes.includes(Buffer.from(PRIVATE_MARKER))));
  book.entries[0].attachments[book.entries[0].attachments.length - 1].share = false;
  const privateCopy = await convertPublicationRecord(workspace, book, book.entries[0]);
  assert.ok(!(await Promise.all(privateCopy.assets.map(bytesOf))).some(value => value.equals(prepared.bytes)));
  await writeFile(path.join(root, '.observanda', 'media', asset.id, `public.${prepared.extension}`), Buffer.from('changed'));
  await assert.rejects(store.get(asset.id), error => error.code === 'MEDIA_INVALID');
});

test('bad media and external-reference playlists fail without emitting source paths', async t => {
  if (!available) return t.skip('FFmpeg and ffprobe are required for this test.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'observanda-bad-media-')); await new Workspace(root).create(sampleNotebook());
  const store = new MediaStore(root);
  for (const bytes of [Buffer.from('<script>invalid</script>'), Buffer.from('ffconcat version 1.0\nfile file:///private/file.wav\n')]) {
    await assert.rejects(store.import(bytes, 'audio'), error => error.code === 'MEDIA_INVALID' && !error.message.includes(root));
  }
  assert.deepEqual(await readdir(path.join(root, '.observanda', 'media')), []);
});

test('media endpoints require authentication, support byte ranges, and expose no original route', async t => {
  if (!available) return t.skip('FFmpeg and ffprobe are required for this test.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'observanda-media-http-')); await new Workspace(root).create(sampleNotebook());
  const app = await startServer({ root, port: 0 }); t.after(app.close);
  const auth = await fetch(app.origin + '/api/session', { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: app.launchToken }) });
  const cookie = auth.headers.get('x-observanda-session').split(';')[0];
  const response = await fetch(app.origin + '/api/media/audio', { method: 'POST', headers: { 'X-Observanda-Session': cookie, Origin: app.origin, 'Content-Type': 'application/octet-stream' }, body: fixtures.audio.bytes });
  assert.equal(response.status, 201); const asset = await response.json();
  assert.equal((await fetch(app.origin + '/api/media/' + asset.id)).status, 401);
  const partial = await fetch(app.origin + '/api/media/' + asset.id, { headers: { 'X-Observanda-Session': cookie, Range: 'bytes=0-11' } });
  assert.equal(partial.status, 206); assert.equal((await partial.arrayBuffer()).byteLength, 12);
  assert.equal((await fetch(app.origin + '/api/media/' + asset.id + '/original', { headers: { 'X-Observanda-Session': cookie } })).status, 404);
  assert.equal((await fetch(app.origin + '/api/media/' + asset.id, { headers: { 'X-Observanda-Session': cookie, Range: 'bytes=999999999-' } })).status, 416);
});

test('a website copy refuses modified prepared media',async t=>{
 if(!available)return t.skip('FFmpeg required');const root=await mkdtemp(path.join(os.tmpdir(),'observanda-stream-site-')),book=sampleNotebook(),workspace=new Workspace(root);await workspace.create(book);const store=new MediaStore(root),asset=await store.import(fixtures.audio.bytes,'audio');book.entries[0].attachments.push({...asset,caption:'Audio',alt:'Audio',transcript:'',share:true});
 assert.ok((await convertPublicationRecord(workspace,book,book.entries[0])).assets.some(value=>value.contentType==='audio/wav'));
 await writeFile(path.join(root,'.observanda','media',asset.id,'public.wav'),Buffer.alloc(100));await assert.rejects(convertPublicationRecord(workspace,book,book.entries[0]),e=>e.code==='MEDIA_INVALID');
});
