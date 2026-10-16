import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localUrl,externalUrl,launchUrl} from '../desktop/policy.js';
test('desktop navigation keeps the authenticated app origin isolated from external content',()=>{
 const origin='http://127.0.0.1:4173';
 assert.ok(localUrl(origin+'/preview/review/index.html',origin));
 for(const url of ['http://127.0.0.1:4174/','http://127.0.0.1.evil.example:4173/','http://user@127.0.0.1:4173/','file:///private/key','javascript:alert(1)','data:text/html,<script>'])assert.equal(localUrl(url,origin),false);
 assert.equal(externalUrl('https://example.org/research/'),'https://example.org/research/');
 for(const url of ['javascript:alert(1)','file:///private/key','ms-settings:','https://user:password@example.org/'])assert.equal(externalUrl(url),null);
 assert.ok(launchUrl(origin+'/#'+'a'.repeat(64)));
 for(const url of [origin,origin+'/#/workspace','https://example.org/#'+'a'.repeat(64),origin+'/preview/#'+'a'.repeat(64)])assert.equal(launchUrl(url),false);
});
