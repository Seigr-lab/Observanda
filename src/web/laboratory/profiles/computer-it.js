import {defineProfile,section,text} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys computer-it.<section>.*
export default defineProfile({id:'computer-it',version:1,icon:'code',
 sections:[
  section('environments',[text('field1'),text('field2')]),
  section('datasets',[text('field1'),text('field2')]),
  section('runs',[text('field1'),text('field2')]),
  section('findings',[text('field1'),text('field2')])
 ]
});
