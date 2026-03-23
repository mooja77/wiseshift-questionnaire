import { derived } from 'svelte/store';
import { answers, visibleQuestions } from './answers';
import questionnaire from '$lib/data/questionnaire.json';

export const progress = derived(
  [answers, visibleQuestions],
  ([$answers, $visible]) => {
    const sectionProgress: Record<string, { total: number; answered: number; percent: number }> = {};
    let totalVisible = 0;
    let totalAnswered = 0;

    for (const section of questionnaire.sections) {
      let sectionTotal = 0;
      let sectionAnswered = 0;

      for (const group of section.groups) {
        for (const qid of group.questions) {
          if ($visible.has(qid)) {
            sectionTotal++;
            totalVisible++;
            const answer = $answers[qid];
            if (answer?.value !== undefined && answer?.value !== null && answer?.value !== '') {
              // Check arrays aren't empty
              if (Array.isArray(answer.value) && answer.value.length === 0) continue;
              sectionAnswered++;
              totalAnswered++;
            }
          }
        }
      }

      sectionProgress[section.id] = {
        total: sectionTotal,
        answered: sectionAnswered,
        percent: sectionTotal > 0 ? Math.round((sectionAnswered / sectionTotal) * 100) : 0
      };
    }

    return {
      sections: sectionProgress,
      overall: {
        total: totalVisible,
        answered: totalAnswered,
        percent: totalVisible > 0 ? Math.round((totalAnswered / totalVisible) * 100) : 0
      }
    };
  }
);
