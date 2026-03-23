import { writable, derived } from 'svelte/store';
import questionnaire from '$lib/data/questionnaire.json';
import { answers, visibleQuestions } from './answers';

export type AppPage = 'welcome' | 'questionnaire' | 'review' | 'export';

export const currentPage = writable<AppPage>('welcome');
export const currentSectionIndex = writable(0);
export const currentGroupIndex = writable(0);

export const sections = questionnaire.sections;

export const currentSection = derived(currentSectionIndex, ($idx) => sections[$idx]);

export const currentGroup = derived(
  [currentSectionIndex, currentGroupIndex],
  ([$si, $gi]) => sections[$si]?.groups[$gi]
);

export function nextGroup() {
  currentGroupIndex.update(gi => {
    let si: number = 0;
    currentSectionIndex.subscribe(v => si = v)();
    const section = sections[si];
    if (gi < section.groups.length - 1) {
      return gi + 1;
    } else if (si < sections.length - 1) {
      currentSectionIndex.set(si + 1);
      return 0;
    }
    // Last group of last section — go to review
    currentPage.set('review');
    return gi;
  });
}

export function prevGroup() {
  currentGroupIndex.update(gi => {
    if (gi > 0) return gi - 1;
    let si: number = 0;
    currentSectionIndex.subscribe(v => si = v)();
    if (si > 0) {
      const prevSection = sections[si - 1];
      currentSectionIndex.set(si - 1);
      return prevSection.groups.length - 1;
    }
    return 0;
  });
}

export function goToSection(sectionIndex: number) {
  currentSectionIndex.set(sectionIndex);
  currentGroupIndex.set(0);
  currentPage.set('questionnaire');
}

export function goToGroup(sectionIndex: number, groupIndex: number) {
  currentSectionIndex.set(sectionIndex);
  currentGroupIndex.set(groupIndex);
  currentPage.set('questionnaire');
}

export function startQuestionnaire() {
  currentSectionIndex.set(0);
  currentGroupIndex.set(0);
  currentPage.set('questionnaire');
}
