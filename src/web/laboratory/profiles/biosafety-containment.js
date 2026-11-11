import {defineProfile,section,text} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys biosafety-containment.<section>.*
export default defineProfile({id:'biosafety-containment',version:1,icon:'shield',
 sections:[
  section('assessments',[text('field1'),text('field2')]),
  section('training',[text('field1'),text('field2')]),
  section('facilities',[text('field1'),text('field2')]),
  section('incidents',[text('field1'),text('field2')])
 ]
});
