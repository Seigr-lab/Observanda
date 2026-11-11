import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaValueFixture} from './record-media-values-fixture.js';
import {executeResearchRequest} from '../src/research-requests.js';
import {recordCaptionText} from '../src/record-media-caption-file.js';

import {recordCaptionURL} from '../src/web/record-media-captions.js';

test('the revision view names the exact version in its caption track address',()=>{
 const id='11111111-1111-4111-8111-111111111111',record='22222222-2222-4222-8222-222222222222',revision='a'.repeat(64);
 assert.equal(recordCaptionURL(item=>'/api/media/'+item,id,'en',record,{revision,source:{kind:'workspace',id:'b'.repeat(64)}}),'/api/media/'+id+'/captions/en?record='+record+'&revision='+revision+'&sourceKind=workspace&sourceId='+'b'.repeat(64));
 assert.equal(recordCaptionURL(item=>'/api/media/'+item,id,'en',record,{revision,source:{kind:'current'}}),'/api/media/'+id+'/captions/en?record='+record+'&revision='+revision+'&sourceKind=current');
});

const cue=text=>'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n'+text+'\n';

test('an earlier version of a record plays the captions that version held',async t=>{
 const f=await mediaValueFixture({count:3});t.after(()=>f.close());
 const video=f.record.attachments[2],target=f.target(video.id);assert.equal(video.kind,'video');
 const caption=async text=>{const base=await f.values.read(target);await f.save(base,{...base.value.value,captions:[{language:'en',label:'English',vtt:cue(text)}]});};
 const history=async()=>(await executeResearchRequest(f.workspace,'/api/research/records/history/list',{workspaceId:target.workspaceId,recordId:target.recordId})).versions;
 await caption('First wording');
 const earlier=(await history()).find(version=>version.current);assert.ok(earlier,'current version listed');
 await caption('Corrected wording');
 const ids={recordId:target.recordId,attachmentId:video.id,language:'en'};
 assert.equal(await recordCaptionText(f.workspace,ids),cue('Corrected wording'));
 assert.equal(await recordCaptionText(f.workspace,{...ids,revision:earlier.revision,source:earlier.source}),cue('First wording'));
 // The newest version read by reference is the current wording.
 const latest=(await history()).find(version=>version.current);
 assert.equal(await recordCaptionText(f.workspace,{...ids,revision:latest.revision,source:latest.source}),cue('Corrected wording'));
 await assert.rejects(recordCaptionText(f.workspace,{...ids,language:'ca',revision:earlier.revision,source:earlier.source}),{code:'NOT_FOUND'});
 await assert.rejects(recordCaptionText(f.workspace,{...ids,revision:earlier.revision,source:{kind:'elsewhere'}}),{code:'INVALID'});
});
