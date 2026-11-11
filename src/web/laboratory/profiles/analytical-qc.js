import {defineProfile,section,text} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys analytical-qc.<section>.*
export default defineProfile({id:'analytical-qc',version:1,icon:'chart',
 sections:[
  section('samples',[text('field1'),text('field2')]),
  section('methods',[text('field1'),text('field2')]),
  section('runs',[text('field1'),text('field2')]),
  section('investigations',[text('field1'),text('field2')])
 ]
});
