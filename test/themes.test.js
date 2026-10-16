import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNotebook, upgradeNotebook, validateNotebook } from '../src/model.js';
import { Workspace, digest } from '../src/storage.js';
import { buildPublication, publicProjection } from '../src/publication.js';
import { startingAppearance, contrastChecks, contrastRatio } from '../src/web/themes.js';

test('starting palettes meet the configured color contrast thresholds and remain independently editable', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#abcdef', '#abcdef'), 1);
  for (const theme of ['research', 'studio']) {
    const a = startingAppearance(theme);
    for (const [label, ratio, target] of contrastChecks(a)) assert.ok(ratio >= target, `${theme} ${label}`);
    a.accent = '#ffffff';
    assert.notEqual(startingAppearance(theme).accent, a.accent);
    assert.ok(contrastChecks(a).some(([, ratio, target]) => ratio < target));
    const book = createNotebook('Field notebook', '', theme);
    assert.equal(book.appearance.theme, theme);
  }
});

test('format 3 appearance and original bytes survive upgrade and named-theme saves', async () => {
  const source = createNotebook('Prior work'); source.formatVersion = 3;delete source.website.typography;delete source.website.presentation;delete source.website.palette; delete source.identity; delete source.themes; delete source.activeThemeId;
  for (const key of ['title','description','home','design','assets','layouts','templates']) delete source.website[key];
  for (const key of ['muted','border','fontSize','lineHeight','radius','layout','header']) delete source.appearance[key];
  Object.assign(source.appearance, { accent: '#234567', headingFont: 'editorial', font: 'source-serif', width: 780 });
  const original = JSON.stringify(source), originalAppearance = structuredClone(source.appearance);
  const root = await mkdtemp(path.join(os.tmpdir(), 'observanda-theme-')), file = path.join(root, 'observanda.json');
  await writeFile(file, original);
  const ws = new Workspace(root), current = await ws.read(), book = upgradeNotebook(current.book);
  for (const [key, value] of Object.entries(originalAppearance)) assert.equal(book.appearance[key], value);
  assert.equal(JSON.stringify(source), original);
  const id = randomUUID(); book.themes.push({ id, name: 'Microscopy / \u03b1 & "Night"', appearance: startingAppearance('studio') });
  book.activeThemeId = id; book.appearance = structuredClone(book.themes[0].appearance);
  const saved = await ws.save(book, current.etag), reopened = await ws.read();
  assert.deepEqual(reopened.book.themes, book.themes); assert.equal(reopened.book.activeThemeId, id);
  assert.equal(await readFile(path.join(root,'.observanda','revisions',digest(original) + '.json'),'utf8'), original);
  assert.notEqual(saved.etag, current.etag);
});

test('theme library validation rejects broken references, injection, duplicate IDs and invalid settings', () => {
  for (const mutation of [
    b => { b.activeThemeId = randomUUID(); },
    b => { b.themes.push({ id: b.id, name: 'Collision', appearance: startingAppearance('research') }); },
    b => { b.themes[0].appearance.radius = '0;background:url(file:private)'; },
    b => { b.themes[0].appearance.font = 'custom remote url'; },
    b => { b.themes[0].appearance.width = 100000; },
    b => { b.themes[0].appearance.lineHeight = NaN; },
    b => { b.themes[0].name = ' '; },
    b => { b.themes[0].secret = 'extra'; },
    b => { b.appearance.background = '#ffffff;display:none'; },
    b => { b.themes = Array.from({length:51}, () => ({ id: randomUUID(), name:'Theme', appearance: startingAppearance('research') })); }
  ]) {
    const book = createNotebook(); book.themes = [{ id: randomUUID(), name: 'Valid', appearance: startingAppearance('studio') }]; mutation(book);
    assert.throws(() => validateNotebook(book), { code: 'INVALID' });
  }
});

test('published appearance reflects settings while private preset names and unused styles stay private', () => {
  const book = createNotebook('Research');book.website.home.enabled=true;
  book.themes.push({ id: randomUUID(), name: '/home/private/theme-name <script>', appearance: startingAppearance('studio') });
  book.activeThemeId = book.themes[0].id;
  book.appearance = { ...book.themes[0].appearance, accent:'#5832a8', header:'band', layout:'list', radius:4, fontSize:20, lineHeight:1.6, width:780 };
  const candidate = buildPublication(book), css = candidate.files.get('styles.css');
  assert.match(css, /--accent:#5832a8;/); assert.match(css, /--reading-width:780px;/); assert.match(css, /--corner-radius:4px;/); assert.match(css, /--body-size:20px;/);
  assert.match(candidate.files.get('index.html'), /class="studio cards-list header-band navigation-top heading-split"/);
  assert.ok(!Object.hasOwn(publicProjection(book), 'themes')); assert.ok(!Object.hasOwn(publicProjection(book), 'activeThemeId'));
  assert.ok(![...candidate.files.values()].join('').includes('private/theme-name'));
});
