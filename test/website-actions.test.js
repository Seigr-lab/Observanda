import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {newElement} from '../src/web/composition-tree.js';
import {actionStyleRules,sectionActionRules} from '../src/web/website-action-style.js';

test('action typography keeps weight controls effective with variable fonts and isolates a changed family',()=>{
 assert.equal(actionStyleRules({fontAxes:{wght:650,opsz:16}}),'--action-font-axes:"opsz" 16;--action-font-weight:650');
 assert.match(actionStyleRules({font:'modern'}),/--action-font-axes:normal/);
 const section={...newElement('popup',randomUUID),close:{appearance:'button',style:{fontWeight:550,fontAxes:{opsz:24,wght:700}}}};
 const css=sectionActionRules(section,'#popup').join('');assert.match(css,/--action-font-weight:550/);assert.match(css,/--action-font-axes:"opsz" 24/);assert.doesNotMatch(css,/weight:700/);
});

