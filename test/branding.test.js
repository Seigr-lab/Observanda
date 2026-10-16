import {legacyRecords} from './legacy-records.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sampleNotebook } from '../src/sample.js';
import { createNotebook, upgradeNotebook, validateNotebook } from '../src/model.js';
import { buildPublication } from '../src/publication.js';

test('format 2 branding upgrades without mutating the source or discarding existing logos', () => {
  const source = legacyRecords(sampleNotebook()); source.formatVersion = 2;delete source.website.typography;delete source.website.presentation;delete source.website.palette; delete source.identity; delete source.branding; delete source.themes; delete source.activeThemeId;
  for (const key of ['title','description','home','design','assets','layouts','templates']) delete source.website[key];
  for (const key of ['muted', 'border', 'fontSize', 'lineHeight', 'radius', 'layout', 'header']) delete source.appearance[key];
  source.website.logoId = randomUUID(); source.projects[0].logoId = randomUUID();
  const before = JSON.stringify(source), upgraded = upgradeNotebook(source);
  assert.equal(JSON.stringify(source), before); assert.equal(upgraded.formatVersion, 21);
  assert.equal(upgraded.website.logoId, source.website.logoId); assert.equal(upgraded.projects[0].logoId, source.projects[0].logoId);
});

test('home and custom pages can publish without selecting a project; private scope branding never leaks', () => {
  const book = createNotebook('Public workspace'), page = { id: randomUUID(), title: 'About', body: 'Independent investigation', share: true };
  book.pages.push(page);
  book.projects.push({id:randomUUID(),title:'Private work',description:'',share:false,logoId:null});
  book.branding.push({ target: 'project:' + book.projects[0].id, logos: [{ id: randomUUID(), alt: '/home/private/branding' }] });
  const candidate = buildPublication(book);
  assert.ok(candidate.files.has(`pages/${page.id}.html`));
  assert.ok(![...candidate.files.values()].join('').includes('private/branding'));
  book.branding.push({ target: 'page:' + page.id, logos: [{ id: randomUUID(), alt: '/home/private/published-logo' }] });
  assert.throws(() => buildPublication(book), { code: 'PRIVACY' });
});

test('branding rejects dangling scopes and excessive logos', () => {
  const book = createNotebook(); book.branding.push({ target: 'page:' + randomUUID(), logos: [] });
  assert.throws(() => validateNotebook(book), { code: 'INVALID' });
  book.branding = [{ target: 'home', logos: Array.from({ length: 5 }, () => ({ id: randomUUID(), alt: '' })) }];
  assert.throws(() => validateNotebook(book), { code: 'INVALID' });
});
