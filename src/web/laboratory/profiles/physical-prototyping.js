import {defineProfile,section,text} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys physical-prototyping.<section>.*
export default defineProfile({id:'physical-prototyping',version:1,icon:'code',
 sections:[
  section('design',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5')]),
  section('assembly',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5')]),
  section('bring-up',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5'),text('field6')]),
  section('rework',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5')]),
  section('findings',[text('field1'),text('field2'),text('field3')])
 ]
});
