import {defineProfile,section,text} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys crime-forensic.<section>.*
export default defineProfile({id:'crime-forensic',version:1,icon:'search',
 sections:[
  section('cases',[text('field1'),text('field2')]),
  section('evidence',[text('field1'),text('field2')]),
  section('examinations',[text('field1'),text('field2')]),
  section('reports',[text('field1'),text('field2')])
 ]
});
