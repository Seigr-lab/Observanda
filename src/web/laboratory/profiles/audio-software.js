// Record-keeping references, reviewed 2026-11-11:
// https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Validator/Index.html (VST 3 validator: automated plug-in conformance tests)
// https://developer.apple.com/documentation/audiotoolbox/audio-unit-v3-plug-ins (Audio Unit hosting and validation)
// https://reproducible-builds.org/docs/definition/ (identifying build outputs by digest)
// Version 2 gives each plug-in its own identity and keeps exported binaries
// identified by digest, so builds, host tests, listening comparisons and
// release decisions link to the plug-in and the exact binary they concern.
import {defineProfile,section,text,select} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys audio-software.<section>.*
const v2={since:2};
export default defineProfile({id:'audio-software',version:2,icon:'code',
 tracking:{subjects:['plugin'],primary:'host-test',events:['dsp','build','host-test','listening','release']},
 sections:[
  section('plugin',[text('name'),text('identifier',{format:'identifier'}),text('formats'),text('repository',{format:'uri'}),text('version',{format:'identifier'}),select('status',['prototype','beta','released','retired']),text('notes')],v2),
  section('dsp',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5')]),
  section('build',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5'),text('field6'),text('commit',{format:'identifier',since:2}),text('artefact-sha256',{format:'sha-256',since:2})]),
  section('host-test',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5'),text('field6'),text('field7'),text('binary-sha256',{format:'sha-256',since:2}),select('validator',['passed','failed','not-run'],v2)]),
  section('listening',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5')]),
  section('release',[text('field1'),text('field2'),text('field3'),text('field4'),text('release-sha256',{format:'sha-256',since:2})])
 ]
});
