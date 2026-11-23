import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { encryptedFixture } from './browser/encrypted-fixture.js';
import { TestDeviceStore } from './device-fixture.js';
import { createWorkspaceAccess, takeCreatedVault } from '../src/access.js';
import { clearVault } from '../src/encryption.js';
import { initializeLocation } from '../src/locations.js';
import { createNotebook, validateNotebook, MAX_BYTES } from '../src/model.js';
import { Workspace, serialize } from '../src/storage.js';
import { sampleNotebook } from '../src/sample.js';
import { hasPrivateText } from '../src/privacy.js';
import { convertPublicationRecord } from '../src/publication-conversion-render.js';
import { safeError } from '../src/errors.js';

const temp = () => mkdtemp(path.join(os.tmpdir(), 'observanda-test-'));
const code = expected => error => error.code === expected;

test('new lab books contain no automatic public entries or machine metadata', () => {
  const book = createNotebook('An independent inquiry');
  assert.deepEqual(book.projects,[]);assert.deepEqual(book.notebooks,[]);
  assert.equal(book.entries.length, 0);
  assert.equal(book.formatVersion, 22);
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
  const f = await encryptedFixture(await temp(), sampleNotebook()), ws = f.workspace;
  const initial = await ws.read();
  const changed = structuredClone(initial.book); changed.entries[0].body = 'A new observation.';
  const saved = await ws.save(changed, initial.etag);
  assert.equal(saved.book.revision, initial.book.revision + 1);
  assert.equal((await new Workspace(ws.root, f.vault).read()).book.entries[0].body, 'A new observation.');
  await assert.rejects(ws.save(initial.book, initial.etag), code('CONFLICT'));
  assert.equal((await ws.read()).etag, saved.etag);
});

test('a symlinked internal directory fails closed', async () => {
  const linked = await temp(), outside = await temp(), device = await temp();
  await symlink(outside, path.join(linked, '.observanda'), process.platform === 'win32' ? 'junction' : 'dir');
  const access = await createWorkspaceAccess('', '', new TestDeviceStore({ file: path.join(device, 'device.key') })), vault = takeCreatedVault(access);
  try { await assert.rejects(initializeLocation(linked, createNotebook(), access, vault), code('UNSAFE')); }
  finally { await clearVault(vault); }
  assert.deepEqual(await readdir(outside), []);
});

test('private records and unused collections never reach a website copy', async () => {
  const book = sampleNotebook(), privateEntry = book.entries[2];
  privateEntry.body = String.raw`PRIVATE_SENTINEL_938 C:\Users\ImaginaryResearcher\private.txt`;
  const privateProject = { id: randomUUID(), title: 'PRIVATE_PROJECT_938', description: 'Hidden', share: false, logoId: null };
  book.projects.push(privateProject);
  const copies = [];for (const entry of book.entries) copies.push(await convertPublicationRecord({}, book, entry));
  assert.deepEqual(copies.map(copy => copy.visible), book.entries.map(entry => entry !== privateEntry));
  const joined = copies.map(copy => copy.html + copy.css).join('\n');
  assert.ok(!joined.includes('PRIVATE_SENTINEL_938'));
  assert.ok(!joined.includes('PRIVATE_PROJECT_938'));
  assert.ok(!joined.includes(privateEntry.id));
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
]) test(`selected ${kind} information blocks a website copy without echoing the value`, async () => {
  assert.ok(hasPrivateText(value));
  const book = sampleNotebook(); book.entries[0].body = value;
  await assert.rejects(convertPublicationRecord({}, book, book.entries[0]), error => {
    assert.equal(error.code, 'PRIVACY');
    assert.equal(error.details[0].recordId, book.entries[0].id);
    assert.ok(!JSON.stringify(safeError(error)).includes(value));
    return true;
  });
});

test('private figure labels block a website copy too', async () => {
  const book = sampleNotebook(); book.entries[0].figures[0].series[0].points[1].x = '/home/fictitious/raw';
  await assert.rejects(convertPublicationRecord({}, book, book.entries[0]), code('PRIVACY'));
});

test('legitimate URLs, safe relative references, and markup-as-text remain readable', async () => {
  const book = sampleNotebook();
  book.entries[0].body = 'https://example.org/articles/1 /lab/notes ./figures/plot.svg <script>alert(1)</script>';
  const {html} = await convertPublicationRecord({}, book, book.entries[0]);
  assert.ok(html.includes('https://example.org/articles/1 /lab/notes ./figures/plot.svg'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
});
