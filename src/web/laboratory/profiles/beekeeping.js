// Record-keeping references, reviewed 2026-10-02:
// https://www.mattilsynet.no/dyr/produksjonsdyr/bier/dyreholdjournal-for-bier
// https://inspection.canada.ca/en/animal-health/terrestrial-animals/biosecurity/standards-and-principles/honey-bee-producer-guide
// https://www.nationalbeeunit.com/assets/PDFs/3_Resources_for_beekeepers/Best_practice_guidelines/BPG_2_Handling_and_examining_with_healthy_comb_v8_Layout_1.pdf
// These are editable recording prompts, not diagnoses or treatment instructions.
// Version 2 never publishes keepers' names, contacts and addresses, or apiary
// addresses: books on version 1 gain that protection when they adopt version 2.
import {defineProfile,section,text,number,date,select,unit} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys beekeeping.<section>.*
const personal={private:2};
export default defineProfile({id:'beekeeping',version:2,icon:'leaf',
 tracking:{subjects:['hive','colony'],primary:'inspection',events:['inspection','monitoring','care','movement','colony-event','harvest']},
 sections:[
  section('apiary',[text('apiary-id'),text('site',personal),text('keeper',personal),number('hive-count',unit('hives')),text('forage'),text('access')]),
  section('hive',[text('hive-id'),text('apiary'),text('equipment'),date('in-service'),text('equipment-reference'),text('notes')]),
  section('colony',[text('colony-id'),select('origin',['nucleus','package','captured-swarm','split','united-colonies','established-colony','other','unknown']),text('source'),date('acquired'),text('queen-id'),text('queen-origin'),text('arrival')]),
  section('inspection',[text('inspector'),text('site'),text('weather'),number('temperature','°C'),select('extent',['external-only','partial-internal','full-internal','interrupted']),select('queen',['seen','not-seen','not-checked']),select('eggs',['observed','not-observed','not-checked']),select('larvae',['observed','not-observed','not-checked']),select('sealed-brood',['observed','not-observed','not-checked']),number('bee-frames',unit('frame-equivalents')),number('brood-frames',unit('frame-equivalents')),text('brood-pattern'),text('queen-cells'),text('stores'),text('space'),text('temperament'),text('health'),text('actions'),text('follow-up'),date('next-visit')]),
  section('monitoring',[text('observer'),text('target'),select('method',['alcohol-wash','sugar-roll','natural-mite-drop','brood-examination','visual-inspection','laboratory-analysis','other']),number('sample-bees',unit('bees')),number('mites',unit('mites')),number('duration',unit('hours')),text('sample'),text('result'),select('certainty',['not-assessed','suspected','confirmed-by-identified-method','inconclusive']),text('confirmation'),text('follow-up')]),
  section('care',[select('action',['feeding','treatment','cleaning-disinfection','other']),text('operator'),text('reason'),text('product'),text('composition'),text('quantity'),text('method'),date('start'),date('end'),text('instructions'),text('restrictions'),text('response'),date('recheck')]),
  section('movement',[select('movement-kind',['temporary-forage-move','permanent-move','acquisition','transfer-to-another-keeper','equipment-comb-transfer','other']),text('identifiers'),number('hives',unit('hives')),text('from',personal),text('to',personal),text('sender',personal),text('recipient',personal),date('departure'),date('return'),text('health-check'),text('notes')]),
  section('colony-event',[select('event',['split','union','requeening','swarm-departure','swarm-capture','colony-loss','overwintering-assessment','other']),text('operator'),text('before'),text('after'),text('reason'),text('outcome'),text('follow-up')]),
  section('harvest',[text('batch'),text('operator'),date('harvest-date'),date('extraction-date'),text('source'),text('product'),number('mass','kg'),number('moisture','%'),text('measurement'),text('storage'),text('notes')])
 ]
});
