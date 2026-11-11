// Record-keeping references, reviewed 2026-11-11:
// https://oir.nih.gov/sourcebook/ethical-conduct/responsible-conduct-research-training/guidelines-scientific-record-keeping (NIH guidelines for scientific record keeping)
// https://doi.org/10.1371/journal.pcbi.1004385 (Schnell, Ten simple rules for a computational biologist's laboratory notebook)
// https://www.oecd.org/en/publications/frascati-manual-2015_9789264239012-en.html (OECD Frascati Manual: research and experimental development)
// https://www.gov.uk/government/publications/guidance-on-gxp-data-integrity (ALCOA+: attributable, legible, contemporaneous, original, accurate records)
// Version 2 states hypotheses and predictions, versions protocols with their
// materials and equipment, records experiments with variables, controls,
// measured values and raw data digests, and registers materials and equipment.
import {defineProfile,section,text,number,date,select} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys research-development.<section>.*
const v2={since:2};
export default defineProfile({id:'research-development',version:2,icon:'flask',
 tracking:{subjects:['questions','materials','equipment'],primary:'experiments',events:['protocols','experiments','findings']},
 sections:[
  section('questions',[text('field1'),text('field2'),text('hypothesis',v2),text('alternatives',v2),text('predictions',v2),text('background',v2),select('status',['open','answered','abandoned'],v2)]),
  section('protocols',[text('field1'),text('field2'),text('protocol-id',{format:'identifier',since:2}),text('materials',v2),text('equipment',v2),text('steps',v2),text('safety',v2),text('allowed-deviations',v2)]),
  section('experiments',[text('field1'),text('field2'),text('objective',v2),text('variables',v2),text('controls',v2),number('sample-size','',v2),text('conditions',v2),text('quantity',v2),number('value','',{since:2,uncertainty:'absolute'}),text('unit',v2),text('raw-data',v2),text('raw-data-sha256',{format:'sha-256',since:2}),text('deviations',v2),text('observations',v2)]),
  section('findings',[text('field1'),text('field2'),text('summary',v2),text('analysis',v2),text('uncertainty',v2),select('conclusion',['supports','contradicts','inconclusive'],v2),text('reproduction',v2),text('next',v2)]),
  section('materials',[text('name'),text('supplier'),text('catalogue',{format:'identifier'}),text('lot',{format:'identifier'}),date('received'),date('expiry'),text('storage'),text('certificate')],v2),
  section('equipment',[text('name'),text('model'),text('serial',{format:'identifier'}),select('calibration',['calibrated','due','overdue','not-required']),date('calibration-due'),text('location')],v2)
 ]
});
