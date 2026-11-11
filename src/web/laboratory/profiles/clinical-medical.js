import {defineProfile,section,text} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys clinical-medical.<section>.*
export default defineProfile({id:'clinical-medical',version:1,icon:'medical',
 sections:[
  section('requests',[text('field1'),text('field2')]),
  section('methods',[text('field1'),text('field2')]),
  section('quality',[text('field1'),text('field2')]),
  section('reports',[text('field1'),text('field2')])
 ]
});
