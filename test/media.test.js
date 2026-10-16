import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { mediaFixtures, PRIVATE_MARKER } from './media-fixtures.js';
import { MediaStore, mediaCapabilities } from '../src/media.js';
import { Workspace, digest } from '../src/storage.js';
import { sampleNotebook } from '../src/sample.js';
import { buildPublication, writePublication, publicationZip } from '../src/publication.js';
import { startServer } from '../src/server.js';

let available, fixtures;
before(async () => {
  available = (await mediaCapabilities()).available;
  if (available) fixtures = await mediaFixtures(await mkdtemp(path.join(os.tmpdir(), 'observanda-fixtures-')));
});

for (const kind of ['image', 'audio', 'video']) test(`${kind} originals survive unchanged while prepared copies are playable publication assets`, async t => {
  if (!available) return t.skip('FFmpeg and ffprobe are required for this test.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'observanda-media-'));
  const book = sampleNotebook(), workspace = new Workspace(root); await workspace.create(book);
  const store = new MediaStore(root), asset = await store.import(fixtures[kind].bytes, kind);
  assert.equal(digest(await readFile(path.join(root, '.observanda', 'media', asset.id, 'original'))), digest(fixtures[kind].bytes));
  const prepared = await store.get(asset.id);
  assert.ok(!prepared.bytes.includes(Buffer.from(PRIVATE_MARKER)));
  if (kind === 'image') assert.ok(!prepared.bytes.includes(Buffer.from('zTXt')));
  book.entries[0].attachments.push({ ...asset, caption: 'A synthetic recording', alt: 'Test evidence', transcript: 'A synthetic sound or image.', share: true });
  const candidate = buildPublication(book, { mediaFiles: await store.publicFiles(book) });
  const name = `media/${asset.id}.${prepared.extension}`;
  assert.deepEqual(candidate.files.get(name), prepared.bytes);
  const html = candidate.files.get(`entries/${book.entries[0].id}.html`);
  assert.ok(html.includes(`../${name}`)); assert.ok(html.includes(kind === 'image' ? '<img' : `<${kind} controls`));
  const output = path.join(root, 'site'); await writePublication(candidate, output);
  assert.deepEqual(await readFile(path.join(output, name)), prepared.bytes);
  assert.ok(publicationZip(candidate).includes(prepared.bytes));
  assert.ok(![...candidate.files.values()].some(bytes => Buffer.from(bytes).includes(Buffer.from(PRIVATE_MARKER))));
  book.entries[0].attachments[0].share = false;
  const privateCopy = buildPublication(book, { mediaFiles: await store.publicFiles(book) });
  assert.ok(!privateCopy.files.has(name));
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
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const response = await fetch(app.origin + '/api/media/audio', { method: 'POST', headers: { Cookie: cookie, Origin: app.origin, 'Content-Type': 'application/octet-stream' }, body: fixtures.audio.bytes });
  assert.equal(response.status, 201); const asset = await response.json();
  assert.equal((await fetch(app.origin + '/api/media/' + asset.id)).status, 401);
  const partial = await fetch(app.origin + '/api/media/' + asset.id, { headers: { Cookie: cookie, Range: 'bytes=0-11' } });
  assert.equal(partial.status, 206); assert.equal((await partial.arrayBuffer()).byteLength, 12);
  assert.equal((await fetch(app.origin + '/api/media/' + asset.id + '/original', { headers: { Cookie: cookie } })).status, 404);
  assert.equal((await fetch(app.origin + '/api/media/' + asset.id, { headers: { Cookie: cookie, Range: 'bytes=999999999-' } })).status, 416);
});

test('logos and fonts are included offline; private project logos and media are excluded', async t => {
  if (!available) return t.skip('FFmpeg and ffprobe are required for this test.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'observanda-branding-')), book = sampleNotebook();
  await new Workspace(root).create(book); const store = new MediaStore(root);
  const logo = await store.import(fixtures.image.bytes, 'image');
  book.website.logoId = logo.id; book.website.logoAlt = 'Research collective';
  book.appearance.font = 'atkinson'; book.appearance.headingFont = 'source-serif';
  book.projects.push({ id: randomUUID(), title: 'Private project', description: 'Hidden', share: false, logoId: randomUUID() });
  const candidate = buildPublication(book, { mediaFiles: await store.publicFiles(book) });
  assert.ok(candidate.files.has(`media/${logo.id}.png`));
  for (const name of ['atkinson', 'source-serif']) { assert.ok(candidate.files.has(`fonts/${name}.ttf`)); assert.ok(candidate.files.has(`fonts/${name}-OFL.txt`)); }
  assert.ok(candidate.files.get('index.html').includes('Research collective'));
  assert.ok(!candidate.files.get('index.html').includes('Private project'));
});


test('file-backed publication matches buffered publication and refuses modified media',async t=>{
 if(!available)return t.skip('FFmpeg required');const root=await mkdtemp(path.join(os.tmpdir(),'observanda-stream-site-')),book=sampleNotebook();await new Workspace(root).create(book);const store=new MediaStore(root),asset=await store.import(fixtures.audio.bytes,'audio');book.entries[0].attachments.push({...asset,caption:'Audio',alt:'',transcript:'',share:true});
 const streamed=buildPublication(book,{mediaFiles:await store.publicFiles(book,{streamed:true})}),buffered=buildPublication(book,{mediaFiles:await store.publicFiles(book)});assert.equal(streamed.id,buffered.id);const target=path.join(root,'site');await writePublication(streamed,target);for(const [name,bytes] of buffered.files)assert.deepEqual(await readFile(path.join(target,name)),Buffer.from(bytes));
 await writeFile(path.join(root,'.observanda','media',asset.id,'public.wav'),Buffer.alloc(100));await assert.rejects(writePublication(streamed,path.join(root,'changed')),e=>e.code==='MEDIA_INVALID');
});
