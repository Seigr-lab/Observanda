import {defineProfile,section,text} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys audio-software.<section>.*
export default defineProfile({id:'audio-software',version:1,icon:'code',
 sections:[
  section('dsp',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5')]),
  section('build',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5'),text('field6')]),
  section('host-test',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5'),text('field6'),text('field7')]),
  section('listening',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5')]),
  section('release',[text('field1'),text('field2'),text('field3'),text('field4')])
 ]
});
