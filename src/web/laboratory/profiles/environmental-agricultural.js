// Record-keeping references, reviewed 2026-11-11:
// https://dwc.tdwg.org/terms/ (Darwin Core: basis of record, individual count, life stage, sex, behaviour, coordinate uncertainty, identification qualifier)
// https://doi.org/10.15468/doc-5jp4-5g10 (GBIF: generalizing sensitive species occurrence data)
// https://www.catalogueoflife.org/ and https://www.gbif.org/species (taxon name sources)
// Version 2 makes ecological observation loggable: taxa and sites as tracked
// subjects and occurrences as linked records. The occurrence date is the
// record's own date, with its day, month, year or unknown precision. Precise
// coordinates belong in the site register, which stays private unless shared;
// occurrences carry only a generalized locality for publication.
import {defineProfile,section,text,number,select,unit} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys environmental-agricultural.<section>.*
const v2={since:2};
export default defineProfile({id:'environmental-agricultural',version:2,icon:'leaf',
 tracking:{subjects:['sites','taxon'],primary:'occurrence',events:['campaigns','observations','results','occurrence']},
 sections:[
  section('sites',[text('field1'),text('field2'),text('name',v2),text('habitat',v2),text('precise-location',{since:2,private:true}),text('datum',v2),number('coordinate-uncertainty','m',v2),number('elevation','m',v2),text('generalized-locality',v2),select('sensitivity',['open','generalize','withhold'],v2),text('access',{since:2,private:true})]),
  section('campaigns',[text('field1'),text('field2'),text('protocol',v2),text('effort',v2),text('team',v2)]),
  section('observations',[text('field1'),text('field2'),text('weather',v2),text('conditions',v2),text('observer',v2)]),
  section('results',[text('field1'),text('field2'),text('value',v2),text('uncertainty',v2),text('detection-limit',v2),text('instrument',v2),text('raw-data-sha256',{format:'sha-256',since:2})]),
  section('taxon',[text('scientific-name'),text('authorship'),select('rank',['kingdom','phylum','class','order','family','genus','species','subspecies','variety','form','other']),text('common-names'),text('reference',{format:'uri'}),text('checklist'),text('identification')],v2),
  section('occurrence',[text('taxon'),select('qualifier',['certain','probable','possible','unidentified']),text('identified-by'),select('basis',['human-observation','photograph','sound','specimen','sample','trace']),number('count',unit('individuals')),select('count-type',['exact','estimate','minimum','presence','absence']),select('sex',['female','male','mixed','unknown']),text('life-stage'),text('behaviour'),text('method'),number('effort',unit('minutes')),text('observers'),text('site'),text('generalized-locality'),text('evidence'),text('notes')],v2)
 ]
});
