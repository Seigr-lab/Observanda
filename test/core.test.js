import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, lstat, symlink, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createNotebook, validateNotebook, MAX_BYTES } from '../src/model.js';
import { Workspace, serialize, digest } from '../src/storage.js';
import { sampleNotebook } from '../src/sample.js';
import { hasPrivateText } from '../src/privacy.js';
import { buildPublication, publicationZip, verifyPublication, writePublication, renderChart } from '../src/publication.js';
import { safeError } from '../src/errors.js';

const temp = () => mkdtemp(path.join(os.tmpdir(), 'observanda-test-'));
const code = expected => error => error.code === expected;

test('new lab books contain no automatic public entries or machine metadata', () => {
  const book = createNotebook('An independent inquiry');
  assert.deepEqual(book.projects,[]);assert.deepEqual(book.notebooks,[]);
  assert.equal(book.entries.length, 0);
  assert.equal(book.formatVersion, 21);
  assert.equal(buildPublication(book).entries.length, 0);
  assert.ok(!JSON.stringify(book).includes(os.homedir()));
});

test('validation rejects future formats, unknown fields, invalid dates, relationships and chart numbers', () => {
  for (const mutate of [
    b => { b.formatVersion = 99; }, b => { b.secret = 'hidden'; },
    b => { b.entries[0].occurredOn = '2026-99-99'; }, b => { b.entries[0].occurredOn = '2026-02-30'; },
    b => { b.entries[0].notebookId = randomUUID(); }, b => { b.entries[0].figures[0].series[0].points[0].y = "invalid"; },
    b => { b.entries[0].figures[0].series[0].points[0].y = Infinity; }, b => { b.appearance.accent = 'url(file:private)'; }
  ]) { const book = sampleNotebook(); mutate(book); assert.throws(() => validateNotebook(book)); }
});

test('size limits include on-disk formatting and malformed collections report validation errors', () => {
  const book = sampleNotebook(), template = book.entries[0];
  book.entries = Array.from({ length: 100 }, () => ({ ...structuredClone(template), id: randomUUID(), body: '' }));
  const remaining = MAX_BYTES - Buffer.byteLength(JSON.stringify(book));
  for (const entry of book.entries) entry.body = 'a'.repeat(Math.floor(remaining / book.entries.length));
  assert.ok(Buffer.byteLength(JSON.stringify(book)) <= MAX_BYTES);
  assert.ok(Buffer.byteLength(serialize(book)) > MAX_BYTES);
  assert.throws(() => validateNotebook(book), code('LIMIT'));
  const broken = sampleNotebook(); broken.projects[0] = null;
  assert.throws(() => validateNotebook(broken), code('INVALID'));
});

test('saved changes survive reopening; stale writers cannot replace newer content', async () => {
  const root = await temp(), ws = new Workspace(root);
  const initial = await ws.create(sampleNotebook());
  const changed = structuredClone(initial.book); changed.entries[0].body = 'A new observation.';
  const saved = await ws.save(changed, initial.etag);
  assert.equal(saved.book.revision, 1);
  assert.equal((await new Workspace(root).read()).book.entries[0].body, 'A new observation.');
  await assert.rejects(ws.save(initial.book, initial.etag), code('CONFLICT'));
  assert.equal((await ws.read()).etag, saved.etag);
});

test('external edits and unknown formats are preserved without rewriting', async () => {
  const root = await temp(), ws = new Workspace(root), current = await ws.create(sampleNotebook());
  const external = structuredClone(current.book); external.description = 'Edited outside the app.';
  await writeFile(path.join(root, 'observanda.json'), serialize(external));
  await assert.rejects(ws.save(current.book, current.etag), code('CONFLICT'));
  external.formatVersion = 99;
  const bytes = serialize(external); await writeFile(path.join(root, 'observanda.json'), bytes);
  await assert.rejects(ws.read(), code('FORMAT'));
  assert.equal(await readFile(path.join(root, 'observanda.json'), 'utf8'), bytes);
});

test('old revisions can be restored as a new save; tampering is rejected', async () => {
  const root = await temp(), ws = new Workspace(root), initial = await ws.create(sampleNotebook());
  const next = structuredClone(initial.book); next.title = 'Another title';
  const saved = await ws.save(next, initial.etag), history = await ws.history();
  assert.equal(history.length, 1);
  const restored = await ws.restore(history[0].id, saved.etag);
  assert.equal(restored.book.title, path.basename(root));
  assert.equal((await ws.readRevision(history[0].id)).title, initial.book.title);
  assert.equal(restored.book.revision, 2);
  assert.equal((await ws.history()).length, 2);
  await writeFile(path.join(root, '.observanda', 'revisions', `${history[0].id}.json`), serialize(next));
  await assert.rejects(ws.restore(history[0].id, restored.etag), code('FORMAT'));
});

test('a held writer lock and symlinked internal directory fail closed', async () => {
  const root = await temp(), ws = new Workspace(root), current = await ws.create(sampleNotebook());
  const {workspaceDatabaseLease}=await import('../src/workspace-database-lease.js');
  const lease=await workspaceDatabaseLease(null,{file:path.join(root,'.observanda','write.lock')});
  try{await assert.rejects(ws.save(current.book,current.etag),code('LOCKED'));}finally{await lease.close();}
  const linked = await temp(), outside = await temp();
  await symlink(outside, path.join(linked, '.observanda'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(new Workspace(linked).create(createNotebook()), code('UNSAFE'));
  assert.deepEqual(await readdir(outside), []);
});

test('private records and unused collections never reach the public projection', () => {
  const book = sampleNotebook(), privateEntry = book.entries[2];
  privateEntry.body = String.raw`PRIVATE_SENTINEL_938 C:\Users\ImaginaryResearcher\private.txt`;
  const privateProject = { id: randomUUID(), title: 'PRIVATE_PROJECT_938', description: 'Hidden', share: false, logoId: null };
  book.projects.push(privateProject);
  const candidate = buildPublication(book), joined = [...candidate.files.values()].join('\n');
  assert.equal(candidate.entries.length, 2);
  assert.ok(!joined.includes('PRIVATE_SENTINEL_938'));
  assert.ok(!joined.includes('PRIVATE_PROJECT_938'));
  assert.ok(!joined.includes(privateEntry.id));
  // The explicit public product credit is independent of workspace metadata.
  const repository='https://github.com/Seigr-lab/Observanda';
  assert.ok(joined.includes('href="'+repository+'"'));
  assert.ok(!joined.replaceAll(repository,'').includes('Seigr'));
});

for (const [kind, value] of [
  ['Windows', String.raw`D:\Users\ImaginaryResearcher\notes.txt`],
  ['UNC', String.raw`\\fictional-host\private-share\notes.txt`],
  ['Linux', '/home/imaginary-researcher/notebook'], ['macOS', '/Users/ImaginaryResearcher/Lab book'],
  ['file URI', 'file:///data/private.txt'], ['percent encoding', 'D%3A%5CUsers%5CImaginaryResearcher%5Cnotes.txt'],
  ['double encoding', 'D%253A%255CUsers%255CImaginaryResearcher'], ['HTML entities', 'D&#58;&#92;Users&#92;ImaginaryResearcher'],
  ['JSON escape', String.raw`D\u003a\u005cUsers\u005cImaginaryResearcher`],
  ['base64', Buffer.from('/home/imaginary-researcher/private.txt').toString('base64')],
  ['token', 'ghp_' + 'a'.repeat(36)], ['credential URL', 'https://someone:secret@example.invalid/repo']
]) test(`selected ${kind} information blocks publication without echoing the value`, () => {
  assert.ok(hasPrivateText(value));
  const book = sampleNotebook(); book.entries[0].body = value;
  assert.throws(() => buildPublication(book), error => {
    assert.equal(error.code, 'PRIVACY');
    assert.equal(error.details[0].recordId, book.entries[0].id);
    assert.ok(!JSON.stringify(safeError(error)).includes(value));
    return true;
  });
});

test('private figure labels and metadata fields block export too', () => {
  const book = sampleNotebook(); book.entries[0].figures[0].series[0].points[1].x = '/home/fictitious/raw';
  assert.throws(() => buildPublication(book), code('PRIVACY'));
  book.entries[0].figures = []; book.description = 'machine-id-fixture';
  assert.throws(() => buildPublication(book, { blockedValues: ['machine-id-fixture'] }), code('PRIVACY'));
});

test('legitimate URLs, safe relative references, and markup-as-text remain readable', () => {
  const book = sampleNotebook();
  book.entries[0].body = 'https://example.org/articles/1 /lab/notes ./figures/plot.svg <script>alert(1)</script>';
  const html = buildPublication(book).files.get('index.html');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
});

test('output and ZIP bytes are independent of build location and deterministic', () => {
  const book = sampleNotebook();
  const a = buildPublication(book, { blockedValues: ['/home/fixture-a/book'] });
  const b = buildPublication(book, { blockedValues: [String.raw`Q:\fixture-b\book`] });
  assert.deepEqual([...a.files], [...b.files]);
  assert.deepEqual(publicationZip(a), publicationZip(b));
  const zip = publicationZip(a);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 12), a.files.size);
});

test('manifest covers all payload bytes; mutation after preview blocks download', () => {
  const candidate = buildPublication(sampleNotebook());
  const manifest = JSON.parse(candidate.files.get('publication.json'));
  for (const file of manifest.files) assert.equal(file.sha256, digest(candidate.files.get(file.path)));
  candidate.files.set('index.html', candidate.files.get('index.html') + '\nchanged');
  assert.throws(() => verifyPublication(candidate), code('STALE'));
  assert.throws(() => publicationZip(candidate), code('STALE'));
});

test('directory export is complete and refuses to replace an existing destination', async () => {
  const root = await temp(), destination = path.join(root, 'site');
  const candidate = buildPublication(sampleNotebook());
  await writePublication(candidate, destination);
  for (const [name, bytes] of candidate.files) assert.equal(digest(await readFile(path.join(destination, name))), digest(bytes), name);
  await assert.rejects(writePublication(candidate, destination), code('EXISTS'));
  assert.ok((await lstat(path.join(destination, 'index.html'))).isFile());
  assert.ok(!(await readdir(root)).some(name => name.startsWith('.observanda-build-')));
});

test('chart geometry remains finite for constant, negative, and zero observations', () => {
  for (const kind of ['bar', 'line']) for (const values of [[0, 0], [-5, -5], [-3, 4], [1e12, -1e12]]) {
    const chart = { title: 'Illustration', kind, xLabel: 'Sample', yLabel: 'Value', points: values.map((value, i) => ({ label: String(i), value })) };
    const svg = renderChart(chart);
    assert.ok(!/NaN|Infinity/.test(svg));
    assert.ok(svg.includes('role="img"'));
  }
});
