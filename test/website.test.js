import {legacyRecords} from './legacy-records.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sampleNotebook } from '../src/sample.js';
import { upgradeNotebook } from '../src/model.js';
import { Workspace, digest } from '../src/storage.js';
import { buildPublication } from '../src/publication.js';

test('multiple projects, lab books, custom pages and entries have portable, valid links', () => {
  const book = sampleNotebook(), project = { id: randomUUID(), title: 'Sound studies', description: 'Acoustic investigations', share: true, logoId: null };
  const notebook = { id: randomUUID(), projectId: project.id, title: 'Listening sessions' };
  book.projects.push(project); book.notebooks.push(notebook);
  const entry = { ...structuredClone(book.entries[0]), id: randomUUID(), notebookId: notebook.id, title: 'Room impulse experiment', type: 'experiment', figures: [], sections: [{ id: randomUUID(), title: 'Method', body: 'A repeated clap recording.' }] };
  book.entries.push(entry);
  const page = { id: randomUUID(), title: 'About the lab', body: 'Independent inquiry.', share: true }; book.pages.push(page);
  book.website.navigation = [{ target: 'page:' + page.id, label: 'About us', show: true }, { target: 'project:' + project.id, label: 'Sound', show: true }, { target: 'home', label: 'Overview', show: false }];
  const candidate = buildPublication(book);
  for (const name of [`projects/${project.id}.html`, `notebooks/${notebook.id}.html`, `entries/${entry.id}.html`, `pages/${page.id}.html`]) assert.ok(candidate.files.has(name));
  const home = candidate.files.get('index.html');
  assert.ok(home.indexOf('About us') < home.indexOf('>Sound</a>')); assert.ok(!home.includes('>Overview</a>'));
  assert.ok(candidate.files.get(`entries/${entry.id}.html`).includes('A repeated clap recording.'));
  for (const [name, html] of candidate.files) if (name.endsWith('.html')) {
    for (const [, target] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (target.startsWith('#') || target.startsWith('https://')) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), target));
      assert.ok(candidate.files.has(resolved), `Broken generated link in ${name}`);
    }
  }
});

test('project visibility overrides entry selection and navigation settings', () => {
  const book = sampleNotebook(), project = book.projects[0]; project.share = false;
  book.projects.push({ id: randomUUID(), title: 'Public introduction', description: '', share: true, logoId: null });
  book.website.navigation.push({ target: 'project:' + project.id, label: '/home/private/menu-label', show: true });
  const candidate = buildPublication(book), all = [...candidate.files.values()].join('\n');
  assert.equal(candidate.entries.length, 0); assert.ok(!all.includes(project.id)); assert.ok(!all.includes('private/menu-label'));
});

test('legacy format opens without mutation, upgrades on save, and retains original bytes in history', async () => {
  const legacy = legacyRecords(sampleNotebook()); legacy.formatVersion = 1; delete legacy.identity; delete legacy.website; delete legacy.pages; delete legacy.branding; delete legacy.themes; delete legacy.activeThemeId;
  for (const key of ['muted', 'border', 'fontSize', 'lineHeight', 'radius', 'layout', 'header']) delete legacy.appearance[key];
  for (const key of ['headingFont', 'background', 'surface', 'text']) delete legacy.appearance[key];
  for (const project of legacy.projects) { delete project.share; delete project.logoId; }
  for (const entry of legacy.entries) { delete entry.status; delete entry.sections; delete entry.attachments; }
  const root = await mkdtemp(path.join(os.tmpdir(), 'observanda-legacy-')), file = path.join(root, 'observanda.json');
  const original = JSON.stringify(legacy); await writeFile(file, original);
  const ws = new Workspace(root), current = await ws.read(), next = upgradeNotebook(current.book);
  assert.equal(next.formatVersion, 21); assert.equal(next.projects[0].share, true);
  assert.equal(await readFile(file, 'utf8'), original);
  next.entries[0].sections.push({ id: randomUUID(), title: 'Method', body: 'Additional context.' });
  await ws.save(next, current.etag);
  assert.equal((await ws.read()).book.formatVersion, 21);
  assert.equal(await readFile(path.join(root, '.observanda', 'revisions', digest(original) + '.json'), 'utf8'), original);
});
