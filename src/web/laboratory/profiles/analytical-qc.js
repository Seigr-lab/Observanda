// Record-keeping references, reviewed 2026-11-11:
// https://www.iso.org/standard/66912.html (ISO/IEC 17025: 7.4 handling of test items, 7.5 technical records, 7.6 measurement uncertainty, 7.8.6 decision rules)
// https://www.eurachem.org/index.php/publications/guides/quam (EURACHEM/CITAC QUAM: quantifying uncertainty in analytical measurement)
// https://www.gov.uk/government/publications/guidance-on-gxp-data-integrity (MHRA GxP data integrity: attributable, original and complete records)
// Version 2 adds sample receipt and custody, instrument and reference material
// identity, results with their uncertainty and decision rule, and quality events.
import {defineProfile,section,text,number,date,select} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys analytical-qc.<section>.*
const v2={since:2};
export default defineProfile({id:'analytical-qc',version:2,icon:'chart',
 tracking:{subjects:['samples'],primary:'result',events:['runs','result','investigations']},
 sections:[
  section('samples',[text('field1'),text('field2'),text('sample-id',{format:'identifier',since:2}),date('received',v2),text('received-by',v2),select('condition',['acceptable','accepted-with-comment','rejected'],v2),text('storage',v2),text('custody',v2),text('retention',v2)]),
  section('methods',[text('field1'),text('field2'),text('method-id',{format:'identifier',since:2}),text('validation',v2),text('instrument',{format:'identifier',since:2}),date('calibration-due',v2),text('reference-material',v2),text('limits',v2),text('uncertainty-budget',v2)]),
  section('runs',[text('field1'),text('field2'),text('analyst',v2),text('instrument',{format:'identifier',since:2}),text('sequence',v2),text('standards',v2),select('suitability',['passed','failed','not-applicable'],v2),text('raw-data-sha256',{format:'sha-256',since:2}),text('deviations',v2)]),
  section('result',[text('sample'),text('analyte'),number('value','',{uncertainty:'absolute'}),text('unit'),number('coverage'),text('reported-as'),text('specification'),text('decision-rule'),select('conformity',['conforms','does-not-conform','inconclusive','not-assessed']),text('reviewed-by')],v2),
  section('investigations',[text('field1'),text('field2'),select('kind',['out-of-specification','deviation','nonconformity','complaint','audit-finding'],v2),text('root-cause',v2),text('correction',v2),text('preventive',v2),text('effectiveness',v2),date('closed',v2)])
 ]
});
