import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createNotebook,validateNotebook} from '../src/model.js';
import {startingAppearance,contrastRatio} from '../src/web/themes.js';
// The readable contrast each starting palette must keep (WCAG AA ratios).
function contrastChecks(a) {
  return [
    ['Body text', Math.min(contrastRatio(a.text, a.background), contrastRatio(a.text, a.surface)), 4.5],
    ['Secondary text', Math.min(contrastRatio(a.muted, a.background), contrastRatio(a.muted, a.surface)), 4.5],
    ['Links', Math.min(contrastRatio(a.accent, a.background), contrastRatio(a.accent, a.surface)), 4.5],
    ['Figure marks on white', contrastRatio(a.accent, '#ffffff'), 3]
  ];
}

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

