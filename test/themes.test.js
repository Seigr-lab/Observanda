import {renderingBook} from './fixtures/rendering-book.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createNotebook,validateNotebook} from '../src/model.js';
import {buildPublication,publicProjection} from '../src/publication.js';
import {startingAppearance,contrastChecks,contrastRatio} from '../src/web/themes.js';

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
  const book = renderingBook(createNotebook('Research'));
  book.themes.push({ id: randomUUID(), name: '/home/private/theme-name <script>', appearance: startingAppearance('studio') });
  book.activeThemeId = book.themes[0].id;
  book.appearance = { ...book.themes[0].appearance, accent:'#5832a8', header:'band', layout:'list', radius:4, fontSize:20, lineHeight:1.6, width:780 };
  const candidate = buildPublication(book), css = candidate.files.get('styles.css');
  assert.match(css, /--accent:#5832a8;/); assert.match(css, /--reading-width:780px;/); assert.match(css, /--corner-radius:4px;/); assert.match(css, /--body-size:20px;/);
  assert.match(candidate.files.get('index.html'), /class="studio cards-list header-band navigation-top heading-split"/);
  assert.ok(!Object.hasOwn(publicProjection(book), 'themes')); assert.ok(!Object.hasOwn(publicProjection(book), 'activeThemeId'));
  assert.ok(![...candidate.files.values()].join('').includes('private/theme-name'));
});
