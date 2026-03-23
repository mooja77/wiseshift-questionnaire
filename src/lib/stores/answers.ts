import { writable, derived } from 'svelte/store';
import questionnaire from '$lib/data/questionnaire.json';
import { cloudSave } from '$lib/supabase';

export const lastSaved = writable<string | null>(null);
export const cloudStatus = writable<'idle' | 'saving' | 'saved' | 'error'>('idle');
export const cloudId = writable<string | null>(
  typeof window !== 'undefined' ? localStorage.getItem('wiseshift_cloud_id') : null
);

export interface Answer {
  value: any;
  prefilled?: boolean;
  confirmed?: boolean;
  timestamp?: string;
}

export type AnswerMap = Record<string, Answer>;

const STORAGE_KEY = 'wiseshift_questionnaire_draft';

function loadFromStorage(): AnswerMap {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.answers || {};
    }
  } catch (e) {
    console.warn('Failed to load saved answers:', e);
  }
  return {};
}

function createAnswersStore() {
  const { subscribe, set, update } = writable<AnswerMap>(loadFromStorage());

  let saveTimeout: ReturnType<typeof setTimeout>;
  let cloudSaveTimeout: ReturnType<typeof setTimeout>;

  function saveToStorage(answers: AnswerMap) {
    if (typeof window === 'undefined') return;

    // Local save (debounced 500ms)
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      try {
        const data = {
          meta: {
            version: '1.0',
            lastSaved: new Date().toISOString(),
            wiseName: answers['Q1.1']?.value || ''
          },
          answers
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        lastSaved.set(new Date().toLocaleTimeString());
      } catch (e) {
        console.warn('Failed to save locally:', e);
      }
    }, 500);

    // Cloud save (debounced 3s — less frequent to avoid hammering the API)
    clearTimeout(cloudSaveTimeout);
    cloudSaveTimeout = setTimeout(async () => {
      if (Object.keys(answers).length === 0) return;
      const wiseName = answers['Q1.1']?.value || '';
      const country = answers['Q4.1']?.value || '';

      cloudStatus.set('saving');
      let currentCloudId: string | null = null;
      cloudId.subscribe(v => currentCloudId = v)();

      const result = await cloudSave(currentCloudId, wiseName, country, answers);

      if (result.error) {
        cloudStatus.set('error');
        console.warn('Cloud save failed:', result.error);
      } else {
        cloudStatus.set('saved');
        if (result.id && result.id !== currentCloudId) {
          cloudId.set(result.id);
          localStorage.setItem('wiseshift_cloud_id', result.id);
        }
      }
    }, 3000);
  }

  subscribe(saveToStorage);

  return {
    subscribe,
    setAnswer(questionId: string, value: any) {
      update(answers => ({
        ...answers,
        [questionId]: {
          ...answers[questionId],
          value,
          timestamp: new Date().toISOString(),
          confirmed: answers[questionId]?.prefilled ? answers[questionId]?.confirmed : undefined
        }
      }));
    },
    confirmPrefill(questionId: string) {
      update(answers => ({
        ...answers,
        [questionId]: { ...answers[questionId], confirmed: true }
      }));
    },
    loadAnswers(data: AnswerMap) {
      set(data);
    },
    loadPrefill(data: Record<string, any>) {
      const prefilled: AnswerMap = {};
      for (const [key, value] of Object.entries(data)) {
        prefilled[key] = { value, prefilled: true, confirmed: false, timestamp: new Date().toISOString() };
      }
      set(prefilled);
    },
    clear() {
      set({});
      if (typeof window !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('wiseshift_cloud_id');
      }
      cloudId.set(null);
      cloudStatus.set('idle');
    },
    exportJSON(): string {
      let current: AnswerMap = {};
      subscribe(v => current = v)();
      return JSON.stringify({
        meta: {
          version: '1.0',
          exportDate: new Date().toISOString(),
          wiseName: current['Q1.1']?.value || '',
          questionnaireTitle: questionnaire.meta.title
        },
        answers: current
      }, null, 2);
    }
  };
}

export const answers = createAnswersStore();

// Derived store: which questions are visible based on conditional logic
export const visibleQuestions = derived(answers, ($answers) => {
  const hidden = new Set<string>();

  for (const rule of questionnaire.conditionalRules) {
    const answer = $answers[rule.if.question]?.value;
    const condition = rule.if.equals;

    if (answer === condition || (answer && answer === condition)) {
      for (const qid of rule.hide) {
        hidden.add(qid);
      }
    }
    // Handle "not answered yet" — don't hide conditional questions until trigger is answered
    if (answer === undefined || answer === null || answer === '') {
      // Keep hidden for now
      for (const qid of rule.hide) {
        hidden.add(qid);
      }
    }
  }

  const allQuestionIds = Object.keys(questionnaire.questions);
  const visible = new Set(allQuestionIds.filter(id => !hidden.has(id)));
  return visible;
});
