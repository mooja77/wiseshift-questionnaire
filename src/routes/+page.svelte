<script lang="ts">
  import { currentPage, currentSectionIndex, currentGroupIndex, sections, startQuestionnaire, nextGroup, prevGroup, goToSection } from '$lib/stores/navigation';
  import { answers, visibleQuestions, lastSaved, cloudStatus, cloudId } from '$lib/stores/answers';
  import { cloudList, cloudLoad } from '$lib/supabase';
  import { downloadPDF } from '$lib/utils/pdfExport';
  import { progress } from '$lib/stores/progress';
  import questionnaire from '$lib/data/questionnaire.json';

  // Get current state
  let page = $derived($currentPage);
  let sectionIdx = $derived($currentSectionIndex);
  let groupIdx = $derived($currentGroupIndex);
  let section = $derived(sections[sectionIdx]);
  let group = $derived(section?.groups[groupIdx]);
  let prog = $derived($progress);
  let visible = $derived($visibleQuestions);
  let allAnswers = $derived($answers);
  let savedTime = $derived($lastSaved);
  let cStatus = $derived($cloudStatus);
  let cId = $derived($cloudId);

  // Cloud questionnaire list for the welcome page
  let cloudQuestionnaires = $state<any[]>([]);
  let loadingCloud = $state(false);

  async function loadCloudList() {
    loadingCloud = true;
    const result = await cloudList();
    if (!result.error) {
      cloudQuestionnaires = result.data;
    }
    loadingCloud = false;
  }

  async function handleLoadFromCloud(id: string) {
    const result = await cloudLoad(id);
    if (result.data) {
      answers.loadAnswers(result.data.answers as any);
      cloudId.set(id);
      localStorage.setItem('wiseshift_cloud_id', id);
      startQuestionnaire();
    } else {
      alert('Failed to load from cloud: ' + result.error);
    }
  }

  // Load cloud list on mount — use $effect for reliable SSR-safe loading
  $effect(() => {
    loadCloudList();
  });

  // Get questions for current group
  let groupQuestions = $derived(
    group?.questions
      .filter((qid: string) => visible.has(qid))
      .map((qid: string) => (questionnaire.questions as any)[qid])
      .filter(Boolean) || []
  );

  function handleAnswer(questionId: string, value: any) {
    answers.setAnswer(questionId, value);
  }

  function handleStart() {
    startQuestionnaire();
  }

  function handleContinue() {
    startQuestionnaire();
  }

  function handleClear() {
    if (confirm('Are you sure you want to start over? All saved answers will be lost.')) {
      answers.clear();
    }
  }

  let showMobileMenu = $state(false);
  let showTooltip = $state<string | null>(null);
  let showCelebration = $state(false);
  let celebrationText = $state('');

  function getFilenameBase() {
    const wiseName = allAnswers['Q1.1']?.value || 'WISE';
    const date = new Date().toISOString().split('T')[0];
    return `WISESHIFT_${wiseName.replace(/[^a-zA-Z0-9]/g, '_')}_${date}`;
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportJSON() {
    const json = answers.exportJSON();
    downloadBlob(new Blob([json], { type: 'application/json' }), getFilenameBase() + '.json');
  }

  function handleExportCSV() {
    const rows: string[][] = [['section', 'question_id', 'question_text', 'answer_type', 'answer_value', 'prefilled', 'confirmed']];
    for (const sec of questionnaire.sections) {
      for (const grp of sec.groups) {
        for (const qid of grp.questions) {
          const q = (questionnaire.questions as any)[qid];
          if (!q) continue;
          const a = allAnswers[qid];
          let val = '';
          if (a?.value !== undefined && a?.value !== null) {
            val = typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value);
          }
          // Also collect sub-answers for complex types
          const subKeys = Object.keys(allAnswers).filter(k => k.startsWith(qid + '_'));
          if (subKeys.length > 0 && !a?.value) {
            const subVals = subKeys.map(k => `${k.replace(qid + '_', '')}=${allAnswers[k]?.value ?? ''}`);
            val = subVals.join('; ');
          }
          rows.push([
            `Section ${sec.number}`,
            q.number || qid,
            `"${(q.text || '').replace(/"/g, '""')}"`,
            q.type,
            `"${val.replace(/"/g, '""')}"`,
            String(a?.prefilled || false),
            String(a?.confirmed || false)
          ]);
        }
      }
    }
    const csv = rows.map(r => r.join(',')).join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), getFilenameBase() + '.csv');
  }

  function handleExportPDF() {
    downloadPDF(allAnswers, visible);
  }

  function triggerCelebration(text: string) {
    celebrationText = text;
    showCelebration = true;
    setTimeout(() => { showCelebration = false; }, 3000);
  }

  function handleImport(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (data.answers) {
          answers.loadAnswers(data.answers);
          const total = Object.keys(data.answers).length;
          const prefilled = Object.values(data.answers).filter((a: any) => a.prefilled).length;
          const wiseName = data.meta?.wiseName || data.answers['Q1.1']?.value || 'Unknown';
          if (prefilled > 0) {
            alert(`Loaded pre-filled data for "${wiseName}".\n\n${prefilled} answers pre-filled from desk research.\nPlease review and confirm each answer during the interview.`);
          }
          startQuestionnaire();
        }
      } catch (err) {
        alert('Could not read this file. Please make sure it is a valid WISESHIFT questionnaire file.');
      }
    };
    reader.readAsText(file);
  }

  // Check if there are saved answers
  let hasSavedAnswers = $derived(Object.keys(allAnswers).length > 0);

  // Is this the last group?
  let isLastGroup = $derived(
    sectionIdx === sections.length - 1 &&
    groupIdx === section?.groups.length - 1
  );
  let isFirstGroup = $derived(sectionIdx === 0 && groupIdx === 0);

  // Track section changes for celebration
  let prevSectionIdx = $state(0);
  function handleNextGroup() {
    const oldSection = sectionIdx;
    nextGroup();
    // Check if we moved to a new section
    setTimeout(() => {
      let newSection = 0;
      currentSectionIndex.subscribe(v => newSection = v)();
      if (newSection !== oldSection) {
        const pct = prog.sections[sections[oldSection].id]?.percent || 0;
        triggerCelebration(`Section ${oldSection + 1} complete — ${pct}% filled. Great progress!`);
      }
    }, 50);
  }
</script>

<!-- WELCOME PAGE -->
{#if page === 'welcome'}
<div class="min-h-screen bg-[var(--color-background)] flex items-center justify-center p-4 sm:p-6">
  <div class="max-w-2xl w-full">
    <!-- Header -->
    <div class="text-center mb-8 sm:mb-12">
      <div class="inline-flex items-center gap-2 bg-[var(--color-primary-light)] text-[var(--color-primary)] px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold mb-4 sm:mb-6">
        WISESHIFT · Horizon Europe
      </div>
      <h1 class="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--color-text)] mb-3 sm:mb-4 leading-tight">
        Organisational Overview<br>Questionnaire
      </h1>
      <p class="text-base sm:text-lg text-[var(--color-text-secondary)] max-w-lg mx-auto px-2">
        This questionnaire takes approximately <strong>90 minutes</strong> to complete.
        Your progress saves automatically — you can leave and come back at any time.
      </p>
    </div>

    <!-- Action Cards -->
    <div class="space-y-3 sm:space-y-4">
      <button onclick={handleStart}
        class="w-full bg-[var(--color-surface)] border-2 border-[var(--color-border)] rounded-xl p-4 sm:p-6 text-left hover:border-[var(--color-primary)] hover:shadow-md transition-all cursor-pointer group">
        <div class="flex items-center gap-3 sm:gap-4">
          <div class="w-10 h-10 sm:w-12 sm:h-12 bg-[var(--color-primary-light)] rounded-xl flex items-center justify-center text-xl sm:text-2xl group-hover:bg-[var(--color-primary)] group-hover:text-white transition-colors flex-shrink-0">
            ✦
          </div>
          <div class="min-w-0">
            <h3 class="text-base sm:text-lg font-semibold text-[var(--color-text)]">Start New Questionnaire</h3>
            <p class="text-[var(--color-text-secondary)] text-xs sm:text-sm">Begin a fresh questionnaire for a new organisation</p>
          </div>
        </div>
      </button>

      {#if hasSavedAnswers}
      <button onclick={handleContinue}
        class="w-full bg-[var(--color-surface)] border-2 border-[var(--color-accent)] rounded-xl p-4 sm:p-6 text-left hover:shadow-md transition-all cursor-pointer group">
        <div class="flex items-center gap-3 sm:gap-4">
          <div class="w-10 h-10 sm:w-12 sm:h-12 bg-[var(--color-accent-light)] rounded-xl flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
            ▶
          </div>
          <div class="min-w-0">
            <h3 class="text-base sm:text-lg font-semibold text-[var(--color-text)]">Continue Saved Progress</h3>
            <p class="text-[var(--color-text-secondary)] text-xs sm:text-sm">
              {prog.overall.percent}% complete · {prog.overall.answered} of {prog.overall.total} questions answered
            </p>
          </div>
        </div>
      </button>
      {/if}

      <label
        class="w-full bg-[var(--color-surface)] border-2 border-[var(--color-border)] rounded-xl p-4 sm:p-6 text-left hover:border-[var(--color-primary)] hover:shadow-md transition-all cursor-pointer group block">
        <div class="flex items-center gap-3 sm:gap-4">
          <div class="w-10 h-10 sm:w-12 sm:h-12 bg-[var(--color-primary-light)] rounded-xl flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
            ↑
          </div>
          <div class="min-w-0">
            <h3 class="text-base sm:text-lg font-semibold text-[var(--color-text)]">Load Saved File</h3>
            <p class="text-[var(--color-text-secondary)] text-xs sm:text-sm">Upload a previously saved .json questionnaire file</p>
          </div>
        </div>
        <input type="file" accept=".json" onchange={handleImport} class="hidden" />
      </label>
    </div>

    <!-- Cloud saved questionnaires -->
    <div class="mt-6 sm:mt-8">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">Saved Questionnaires</h3>
        <button onclick={loadCloudList} class="text-xs text-[var(--color-primary)] hover:underline">
          {loadingCloud ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {#if loadingCloud}
      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 text-center">
        <span class="text-sm text-[var(--color-text-secondary)]">Loading saved questionnaires from cloud...</span>
      </div>
      {:else if cloudQuestionnaires.length === 0}
      <div class="bg-[var(--color-surface)] border border-[var(--color-border-light)] rounded-lg p-4 text-center">
        <span class="text-sm text-[var(--color-text-secondary)]">No saved questionnaires yet. Start a new one above.</span>
      </div>
      {:else}
      <div class="space-y-2">
        {#each cloudQuestionnaires as cq}
        <button
          onclick={() => handleLoadFromCloud(cq.id)}
          class="w-full bg-[var(--color-surface)] border-2 border-[var(--color-border)] rounded-xl p-4 sm:p-5 text-left hover:border-[var(--color-primary)] hover:shadow-md transition-all group"
        >
          <div class="flex items-center gap-3 sm:gap-4">
            <div class="w-10 h-10 sm:w-12 sm:h-12 bg-[var(--color-success-light)] rounded-xl flex items-center justify-center text-lg sm:text-xl flex-shrink-0 group-hover:bg-[var(--color-success)] group-hover:text-white transition-colors">
              📋
            </div>
            <div class="flex-1 min-w-0">
              <span class="text-sm sm:text-base font-semibold text-[var(--color-text)] block truncate">{cq.wise_name || 'Untitled Questionnaire'}</span>
              <span class="text-xs sm:text-sm text-[var(--color-text-secondary)]">
                {cq.country ? cq.country + ' · ' : ''}Last saved {new Date(cq.updated_at).toLocaleDateString()} at {new Date(cq.updated_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
              </span>
            </div>
            <span class="text-xs sm:text-sm text-[var(--color-primary)] font-medium flex-shrink-0 group-hover:underline">Open →</span>
          </div>
        </button>
        {/each}
      </div>
      {/if}
    </div>

    <!-- Footer -->
    <p class="text-center text-[10px] sm:text-xs text-[var(--color-text-secondary)] mt-8 sm:mt-12 leading-relaxed px-2">
      Grant Agreement No. 101178477. Views and opinions expressed are those of the author(s) only
      and do not necessarily reflect those of the European Union or the European Research Executive Agency (REA).
    </p>
  </div>
</div>

<!-- QUESTIONNAIRE PAGE -->
{:else if page === 'questionnaire'}
<div class="min-h-screen bg-[var(--color-background)] flex">
  <!-- Sidebar -->
  <aside class="w-72 bg-[var(--color-surface)] border-r border-[var(--color-border)] p-6 hidden lg:flex flex-col flex-shrink-0">
    <div class="text-sm font-semibold text-[var(--color-primary)] mb-6 uppercase tracking-wide">Sections</div>
    <nav class="space-y-2 flex-1">
      {#each sections as sec, si}
      <button
        onclick={() => goToSection(si)}
        class="w-full text-left px-4 py-3 rounded-lg transition-all {si === sectionIdx ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)] font-semibold' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]'}"
      >
        <div class="flex items-center justify-between">
          <span class="text-sm">{sec.number}. {sec.title.split('(')[0].trim()}</span>
          <span class="text-xs font-mono {prog.sections[sec.id]?.percent === 100 ? 'text-[var(--color-success)]' : ''}">{prog.sections[sec.id]?.percent || 0}%</span>
        </div>
      </button>
      {/each}
    </nav>

    <!-- Sidebar footer -->
    <div class="mt-6 pt-6 border-t border-[var(--color-border)] space-y-2">
      <button onclick={handleExportJSON}
        class="w-full text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] px-4 py-2 rounded-lg hover:bg-[var(--color-background)] text-left transition-colors">
        💾 Save to file
      </button>
      <button onclick={() => currentPage.set('review')}
        class="w-full text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] px-4 py-2 rounded-lg hover:bg-[var(--color-background)] text-left transition-colors">
        📋 Review all answers
      </button>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="flex-1 flex flex-col min-h-screen">
    <!-- Top Progress Bar -->
    <div class="h-1 bg-[var(--color-border-light)]">
      <div class="h-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-accent)] transition-all duration-500" style="width: {prog.overall.percent}%"></div>
    </div>

    <!-- Header Bar -->
    <header class="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 lg:px-6 py-3 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <!-- Mobile menu toggle -->
        <button onclick={() => showMobileMenu = !showMobileMenu}
          class="lg:hidden w-10 h-10 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]">
          ☰
        </button>
        <button onclick={() => currentPage.set('welcome')} class="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors hidden sm:block">
          ← Back to start
        </button>
      </div>
      <div class="flex items-center gap-2 sm:gap-3 text-xs font-medium">
        <span class="{savedTime ? 'text-[var(--color-success)]' : 'text-[var(--color-text-secondary)]'}">
          {#if savedTime}
            <span class="hidden sm:inline">Saved at {savedTime}</span><span class="sm:hidden">Saved</span> ✓
          {:else}
            Auto-save
          {/if}
        </span>
        <span class="hidden sm:inline text-[var(--color-border)]">|</span>
        <span class="{cStatus === 'saved' ? 'text-[var(--color-primary)]' : cStatus === 'saving' ? 'text-[var(--color-accent)]' : cStatus === 'error' ? 'text-[var(--color-error)]' : 'text-[var(--color-text-secondary)]'}">
          {#if cStatus === 'saving'}
            Cloud ↑
          {:else if cStatus === 'saved'}
            Cloud ✓
          {:else if cStatus === 'error'}
            Cloud ✗
          {:else}
            <span class="hidden sm:inline">Cloud idle</span>
          {/if}
        </span>
      </div>
    </header>

    <!-- Mobile sidebar overlay -->
    {#if showMobileMenu}
    <div class="fixed inset-0 z-50 lg:hidden">
      <div class="absolute inset-0 bg-black/30" onclick={() => showMobileMenu = false}></div>
      <div class="absolute left-0 top-0 bottom-0 w-72 bg-[var(--color-surface)] shadow-xl p-6 overflow-y-auto">
        <div class="flex items-center justify-between mb-6">
          <span class="text-sm font-semibold text-[var(--color-primary)] uppercase tracking-wide">Sections</span>
          <button onclick={() => showMobileMenu = false} class="text-xl text-[var(--color-text-secondary)]">✕</button>
        </div>
        <nav class="space-y-2">
          {#each sections as sec, si}
          <button
            onclick={() => { goToSection(si); showMobileMenu = false; }}
            class="w-full text-left px-4 py-3 rounded-lg transition-all {si === sectionIdx ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)] font-semibold' : 'text-[var(--color-text-secondary)]'}"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm">{sec.number}. {sec.title.split('(')[0].trim()}</span>
              <span class="text-xs font-mono">{prog.sections[sec.id]?.percent || 0}%</span>
            </div>
          </button>
          {/each}
        </nav>
        <div class="mt-6 pt-6 border-t border-[var(--color-border)] space-y-2">
          <button onclick={() => { handleExportJSON(); showMobileMenu = false; }}
            class="w-full text-sm text-left px-4 py-2 rounded-lg hover:bg-[var(--color-background)]">💾 Save to file</button>
          <button onclick={() => { currentPage.set('review'); showMobileMenu = false; }}
            class="w-full text-sm text-left px-4 py-2 rounded-lg hover:bg-[var(--color-background)]">📋 Review answers</button>
        </div>
      </div>
    </div>
    {/if}

    <!-- Celebration banner -->
    {#if showCelebration}
    <div class="bg-gradient-to-r from-[var(--color-success-light)] to-[var(--color-primary-light)] px-6 py-3 text-center text-sm font-medium text-[var(--color-success)] animate-pulse">
      {celebrationText}
    </div>
    {/if}

    <!-- Content Area -->
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-[720px] mx-auto px-3 sm:px-6 py-6 sm:py-10">
        <!-- Section & Group Header -->
        <div class="mb-6 sm:mb-8">
          <div class="text-xs sm:text-sm font-semibold text-[var(--color-primary)] uppercase tracking-wide mb-1">
            Section {section.number} · {group?.title}
          </div>
          <h2 class="text-xl sm:text-2xl font-bold text-[var(--color-text)]">{section.title}</h2>
          {#if groupIdx === 0}
          <p class="text-sm sm:text-base text-[var(--color-text-secondary)] mt-2">{section.intro}</p>
          {/if}
        </div>

        <!-- Questions -->
        <div class="space-y-5 sm:space-y-8">
          {#each groupQuestions as q (q.id)}
          <div class="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 sm:p-6 shadow-sm">
            <!-- Question Label -->
            <div class="flex items-start gap-2 sm:gap-3 mb-3 sm:mb-4">
              <span class="text-[10px] sm:text-xs font-mono bg-[var(--color-primary-light)] text-[var(--color-primary)] px-1.5 sm:px-2 py-0.5 sm:py-1 rounded flex-shrink-0 mt-0.5">
                {q.number}
              </span>
              <div class="flex-1 min-w-0">
                <label class="text-sm sm:text-base text-[var(--color-text)] font-medium leading-relaxed block">
                  {q.text}
                </label>
                {#if q.hint}
                <p class="text-xs sm:text-sm text-[var(--color-text-secondary)] mt-1">{q.hint}</p>
                {/if}
              </div>
              {#if q.appendixF}
              <button
                onclick={() => showTooltip = showTooltip === q.id ? null : q.id}
                class="flex-shrink-0 w-7 h-7 sm:w-6 sm:h-6 rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)] text-xs font-bold flex items-center justify-center hover:bg-[var(--color-accent)] hover:text-white transition-colors cursor-help"
              >?</button>
              {/if}
            </div>

            <!-- Tooltip popover -->
            {#if q.appendixF && showTooltip === q.id}
            <div class="mb-4 bg-[var(--color-accent-light)] border border-[var(--color-accent)]/20 rounded-lg p-4 relative">
              <button onclick={() => showTooltip = null} class="absolute top-2 right-2 text-[var(--color-accent)] hover:text-[var(--color-text)] text-sm">✕</button>
              <div class="text-xs font-semibold text-[var(--color-accent)] uppercase tracking-wide mb-2">Coding Guideline (Appendix F)</div>
              <p class="text-sm text-[var(--color-text)] leading-relaxed">{q.appendixF}</p>
            </div>
            {/if}

            <!-- Pre-fill badge -->
            {#if allAnswers[q.id]?.prefilled}
            <div class="mb-3 flex items-center gap-2">
              <span class="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-warning)] bg-[var(--color-warning-light)] px-2 py-1 rounded">
                Pre-filled from desk research
                {#if allAnswers[q.id]?.confirmed}
                <span class="text-[var(--color-success)]">· Confirmed ✓</span>
                {/if}
              </span>
              {#if !allAnswers[q.id]?.confirmed}
              <button
                onclick={() => answers.confirmPrefill(q.id)}
                class="text-xs font-medium text-[var(--color-primary)] bg-[var(--color-primary-light)] px-2 py-1 rounded hover:bg-[var(--color-primary)] hover:text-white transition-colors"
              >Confirm ✓</button>
              {/if}
            </div>
            {/if}

            <!-- N/A toggle -->
            <div class="flex items-center justify-end mb-2">
              <button
                onclick={() => handleAnswer(q.id + '__na', allAnswers[q.id + '__na']?.value ? false : true)}
                class="text-xs px-2 py-1 rounded transition-colors {allAnswers[q.id + '__na']?.value ? 'bg-[var(--color-text-secondary)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]'}"
              >N/A</button>
            </div>

            {#if allAnswers[q.id + '__na']?.value}
            <div class="text-sm text-[var(--color-text-secondary)] italic bg-[var(--color-background)] rounded-lg p-3">
              Marked as not available / not applicable
            </div>
            {:else}

            <!-- Input based on type -->
            {#if q.type === 'text' || q.type === 'year'}
            <input
              type={q.type === 'year' ? 'number' : 'text'}
              value={allAnswers[q.id]?.value || ''}
              oninput={(e) => handleAnswer(q.id, (e.target as HTMLInputElement).value)}
              placeholder={q.placeholder || ''}
              class="w-full h-12 px-4 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] bg-[var(--color-surface)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-light)] outline-none transition-colors"
            />

            {:else if q.type === 'yes_no'}
            <div class="flex gap-3">
              {#each [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] as opt}
              <button
                onclick={() => handleAnswer(q.id, opt.value)}
                class="flex-1 h-14 rounded-xl border-2 font-semibold text-lg transition-all
                  {allAnswers[q.id]?.value === opt.value
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]'}"
              >
                {opt.label}
              </button>
              {/each}
            </div>

            {:else if q.type === 'single_tick'}
            <div class="space-y-2">
              {#each q.options as opt}
              <button
                onclick={() => handleAnswer(q.id, opt.value)}
                class="w-full text-left px-4 py-3 rounded-lg border-2 transition-all
                  {allAnswers[q.id]?.value === opt.value
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] border-l-4'
                    : 'border-[var(--color-border)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]'}"
              >
                <span class="text-sm">{opt.label}</span>
              </button>
              {#if opt.hasTextField && allAnswers[q.id]?.value === opt.value}
              <input
                type="text"
                placeholder="Please specify..."
                value={allAnswers[q.id + '_other']?.value || ''}
                oninput={(e) => handleAnswer(q.id + '_other', (e.target as HTMLInputElement).value)}
                class="w-full h-10 px-4 ml-6 border border-[var(--color-border)] rounded-lg text-sm"
              />
              {/if}
              {/each}
            </div>

            {:else if q.type === 'multi_tick'}
            <div class="space-y-2">
              {#each q.options as opt}
              {@const currentVal = (allAnswers[q.id]?.value as string[]) || []}
              {@const isChecked = currentVal.includes(opt.value)}
              <button
                onclick={() => {
                  const current = [...((allAnswers[q.id]?.value as string[]) || [])];
                  const idx = current.indexOf(opt.value);
                  if (idx >= 0) current.splice(idx, 1);
                  else current.push(opt.value);
                  handleAnswer(q.id, current);
                }}
                class="w-full text-left px-4 py-3 rounded-lg border-2 transition-all flex items-center gap-3
                  {isChecked
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] border-l-4'
                    : 'border-[var(--color-border)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]'}"
              >
                <span class="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 text-xs
                  {isChecked ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-[var(--color-border)]'}">
                  {#if isChecked}✓{/if}
                </span>
                <span class="text-sm">{opt.label}</span>
              </button>
              {#if opt.hasTextField && isChecked}
              <input
                type="text"
                placeholder="Please specify..."
                value={allAnswers[q.id + '_' + opt.value + '_text']?.value || ''}
                oninput={(e) => handleAnswer(q.id + '_' + opt.value + '_text', (e.target as HTMLInputElement).value)}
                class="w-full h-10 px-4 ml-8 border border-[var(--color-border)] rounded-lg text-sm"
              />
              {/if}
              {/each}
            </div>

            {:else if q.type === 'number' || q.type === 'currency'}
            <div class="flex items-center gap-2">
              {#if q.type === 'currency'}
              <span class="text-[var(--color-text-secondary)] font-mono text-sm">{allAnswers['Q4.1']?.value || '€'}</span>
              {/if}
              <input
                type="number"
                value={allAnswers[q.id]?.value ?? ''}
                oninput={(e) => handleAnswer(q.id, (e.target as HTMLInputElement).value ? Number((e.target as HTMLInputElement).value) : null)}
                min={q.min ?? undefined}
                step={q.step ?? 1}
                class="w-full h-12 px-4 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] bg-[var(--color-surface)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-light)] outline-none text-right font-mono"
              />
            </div>

            {:else if q.type === 'currency_pct'}
            <!-- Currency + percentage (revenue table items) -->
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div class="flex items-center gap-2 flex-1">
                <span class="text-[var(--color-text-secondary)] font-mono text-sm flex-shrink-0">{allAnswers['Q4.1']?.value || '€'}</span>
                <input
                  type="number"
                  value={allAnswers[q.id]?.value ?? ''}
                  oninput={(e) => handleAnswer(q.id, (e.target as HTMLInputElement).value ? Number((e.target as HTMLInputElement).value) : null)}
                  placeholder="Amount"
                  class="w-full h-11 px-3 border border-[var(--color-border)] rounded-lg text-right font-mono text-sm"
                />
              </div>
              <div class="flex items-center gap-1 sm:w-28 flex-shrink-0">
                <input
                  type="number" min="0" max="100"
                  value={allAnswers[q.id + '_pct']?.value ?? ''}
                  oninput={(e) => handleAnswer(q.id + '_pct', (e.target as HTMLInputElement).value ? Number((e.target as HTMLInputElement).value) : null)}
                  placeholder="%"
                  class="w-full h-11 px-3 border border-[var(--color-border)] rounded-lg text-right font-mono text-sm"
                />
                <span class="text-[var(--color-text-secondary)] text-sm flex-shrink-0">%</span>
              </div>
            </div>
            {#if q.hasTextField}
            <input type="text" placeholder="Please specify…"
              value={allAnswers[q.id + '_specify']?.value || ''}
              oninput={(e) => handleAnswer(q.id + '_specify', (e.target as HTMLInputElement).value)}
              class="w-full h-10 px-3 mt-2 border border-[var(--color-border)] rounded-lg text-sm"
            />
            {/if}

            {:else if q.type === 'percentage_table'}
            <div class="space-y-3">
              {#each q.options as opt}
              <div class="flex items-center gap-3">
                <span class="flex-1 text-sm text-[var(--color-text)]">{opt.label}</span>
                <div class="flex items-center gap-1 w-24">
                  <input
                    type="number"
                    min="0" max="100"
                    value={allAnswers[q.id + '_' + opt.value]?.value ?? ''}
                    oninput={(e) => handleAnswer(q.id + '_' + opt.value, (e.target as HTMLInputElement).value ? Number((e.target as HTMLInputElement).value) : null)}
                    class="w-20 h-10 px-3 border border-[var(--color-border)] rounded-lg text-right font-mono text-sm"
                  />
                  <span class="text-[var(--color-text-secondary)] text-sm">%</span>
                </div>
              </div>
              {/each}
              <!-- Sum indicator -->
              {#each [q.options.reduce((s: number, opt: any) => s + (Number(allAnswers[q.id + '_' + opt.value]?.value) || 0), 0)] as sum}
              <div class="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
                <span class="text-sm font-medium {sum === 100 ? 'text-[var(--color-success)]' : sum > 0 ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-secondary)]'}">
                  Total: {sum}%
                  {#if sum > 0 && sum !== 100}
                  <span class="text-xs ml-1">(should be 100%)</span>
                  {/if}
                  {#if sum === 100}✓{/if}
                </span>
              </div>
              {/each}
            </div>

            {:else if q.type === 'likert_matrix'}
            <!-- Desktop: table layout -->
            <div class="hidden sm:block overflow-x-auto">
              <table class="w-full">
                <thead>
                  <tr>
                    <th class="text-left text-xs text-[var(--color-text-secondary)] pb-3 pr-4"></th>
                    {#each q.scale as s}
                    <th class="text-center text-xs text-[var(--color-text-secondary)] pb-3 px-2 font-medium">{s.label}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each q.statements as stmt}
                  <tr class="border-t border-[var(--color-border-light)]">
                    <td class="text-sm py-3 pr-4">{stmt.text}</td>
                    {#each q.scale as s}
                    <td class="text-center py-3 px-2">
                      <button
                        onclick={() => handleAnswer(q.id + '_' + stmt.id, s.value)}
                        class="w-8 h-8 rounded-full border-2 transition-all
                          {allAnswers[q.id + '_' + stmt.id]?.value === s.value
                            ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white text-xs font-bold'
                            : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'}"
                      >
                        {#if allAnswers[q.id + '_' + stmt.id]?.value === s.value}{s.value}{/if}
                      </button>
                    </td>
                    {/each}
                  </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <!-- Mobile: card layout per statement -->
            <div class="sm:hidden space-y-4">
              {#each q.statements as stmt}
              <div class="bg-[var(--color-background)] rounded-lg p-3">
                <p class="text-sm text-[var(--color-text)] mb-2">{stmt.text}</p>
                <div class="flex gap-1">
                  {#each q.scale as s}
                  <button
                    onclick={() => handleAnswer(q.id + '_' + stmt.id, s.value)}
                    class="flex-1 py-2 rounded-lg border text-xs font-medium transition-all
                      {allAnswers[q.id + '_' + stmt.id]?.value === s.value
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                        : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}"
                  >{s.value}</button>
                  {/each}
                </div>
                <div class="flex justify-between text-[10px] text-[var(--color-text-secondary)] mt-1 px-1">
                  <span>{q.scale[0].label}</span>
                  <span>{q.scale[q.scale.length - 1].label}</span>
                </div>
              </div>
              {/each}
            </div>

            {:else if q.type === 'ranking_multi'}
            <div class="space-y-2">
              <p class="text-xs text-[var(--color-text-secondary)] mb-3">Select up to {q.maxSelections} items and assign a rank (1 = most important).</p>
              {#each q.options as opt}
              {@const currentSelections = (allAnswers[q.id]?.value as Record<string, number>) || {}}
              {@const rank = currentSelections[opt.value]}
              {@const isSelected = rank !== undefined}
              <div class="flex items-center gap-3">
                <select
                  value={rank ?? ''}
                  onchange={(e) => {
                    const current = { ...((allAnswers[q.id]?.value as Record<string, number>) || {}) };
                    const val = (e.target as HTMLSelectElement).value;
                    if (val === '') {
                      delete current[opt.value];
                    } else {
                      current[opt.value] = Number(val);
                    }
                    handleAnswer(q.id, current);
                  }}
                  class="w-16 h-10 px-2 border border-[var(--color-border)] rounded-lg text-center font-mono text-sm
                    {isSelected ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]' : ''}"
                >
                  <option value="">—</option>
                  {#each Array.from({length: q.maxSelections}, (_, i) => i + 1) as n}
                  <option value={n}>{n}</option>
                  {/each}
                </select>
                <span class="text-sm {isSelected ? 'text-[var(--color-text)] font-medium' : 'text-[var(--color-text-secondary)]'}">{opt.label}</span>
              </div>
              {/each}
            </div>

            {:else if q.type === 'textarea'}
            <textarea
              value={allAnswers[q.id]?.value || ''}
              oninput={(e) => handleAnswer(q.id, (e.target as HTMLTextAreaElement).value)}
              rows="4"
              class="w-full px-4 py-3 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] bg-[var(--color-surface)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-light)] outline-none resize-y"
            ></textarea>

            {:else if q.type === 'repeating_accreditation'}
            <!-- Accreditation fields (Q1.9, Q1.10) -->
            <div class="space-y-4">
              <label class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <input type="checkbox"
                  checked={allAnswers[q.id + '_none']?.value === true}
                  onchange={(e) => handleAnswer(q.id + '_none', (e.target as HTMLInputElement).checked)}
                  class="w-4 h-4 rounded border-[var(--color-border)]"
                />
                None
              </label>
              {#if !allAnswers[q.id + '_none']?.value}
              {#each Array.from({length: q.maxItems || 2}, (_, i) => i + 1) as idx}
              <div class="bg-[var(--color-background)] rounded-lg p-4 border border-[var(--color-border-light)]">
                <div class="text-xs font-semibold text-[var(--color-primary)] mb-3">Accreditation {idx}</div>
                {#each q.fields as field}
                <div class="mb-3">
                  <label class="text-sm text-[var(--color-text-secondary)] block mb-1">{field.label}</label>
                  <input type="text"
                    value={allAnswers[q.id + '_' + idx + '_' + field.id]?.value || ''}
                    oninput={(e) => handleAnswer(q.id + '_' + idx + '_' + field.id, (e.target as HTMLInputElement).value)}
                    class="w-full h-10 px-3 border border-[var(--color-border)] rounded-lg text-sm"
                  />
                </div>
                {/each}
              </div>
              {/each}
              {/if}
            </div>

            {:else if q.type === 'volunteer_count'}
            <!-- Volunteer count (Q1.12c) -->
            <div class="space-y-3">
              {#each q.fields as field}
              <div class="flex items-center gap-3">
                <label class="flex-1 text-sm text-[var(--color-text)]">{field.label}</label>
                <input type="number" min="0"
                  value={allAnswers[q.id + '_' + field.id]?.value ?? ''}
                  oninput={(e) => handleAnswer(q.id + '_' + field.id, (e.target as HTMLInputElement).value ? Number((e.target as HTMLInputElement).value) : null)}
                  class="w-24 h-10 px-3 border border-[var(--color-border)] rounded-lg text-right font-mono text-sm"
                />
              </div>
              {/each}
            </div>

            {:else if q.type === 'secondment'}
            <!-- Secondment (Q1.16) -->
            <div class="space-y-3">
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox"
                  checked={allAnswers[q.id + '_none']?.value === true}
                  onchange={(e) => {
                    handleAnswer(q.id + '_none', (e.target as HTMLInputElement).checked);
                    if ((e.target as HTMLInputElement).checked) {
                      handleAnswer(q.id, 0);
                    }
                  }}
                  class="w-4 h-4 rounded border-[var(--color-border)]"
                />
                None
              </label>
              {#if !allAnswers[q.id + '_none']?.value}
              <div class="flex items-center gap-3">
                <label class="flex-1 text-sm">Number of members of staff seconded</label>
                <input type="number" min="0"
                  value={allAnswers[q.id + '_count']?.value ?? ''}
                  oninput={(e) => handleAnswer(q.id + '_count', (e.target as HTMLInputElement).value ? Number((e.target as HTMLInputElement).value) : null)}
                  class="w-24 h-10 px-3 border border-[var(--color-border)] rounded-lg text-right font-mono text-sm"
                />
              </div>
              <div class="flex items-center gap-3">
                <label class="flex-1 text-sm">If known, total of Full-Time Equivalents (FTEs)</label>
                <input type="number" min="0" step="0.5"
                  value={allAnswers[q.id + '_ftes']?.value ?? ''}
                  oninput={(e) => handleAnswer(q.id + '_ftes', (e.target as HTMLInputElement).value ? Number((e.target as HTMLInputElement).value) : null)}
                  class="w-24 h-10 px-3 border border-[var(--color-border)] rounded-lg text-right font-mono text-sm"
                />
              </div>
              {/if}
            </div>

            {:else if q.type === 'text_with_fields'}
            <!-- Text with sub-fields (Q1.15) -->
            <div class="space-y-3">
              {#each q.fields as field}
              <div class="flex items-center gap-3">
                <label class="flex-1 text-sm">{field.label}</label>
                <div class="flex items-center gap-1">
                  <input type={field.type === 'number' ? 'number' : 'text'}
                    value={allAnswers[q.id + '_' + field.id]?.value ?? ''}
                    oninput={(e) => handleAnswer(q.id + '_' + field.id, (e.target as HTMLInputElement).value)}
                    class="w-48 h-10 px-3 border border-[var(--color-border)] rounded-lg text-sm {field.type === 'number' ? 'text-right font-mono' : ''}"
                  />
                  {#if field.suffix}<span class="text-sm text-[var(--color-text-secondary)]">{field.suffix}</span>{/if}
                </div>
              </div>
              {/each}
            </div>

            {:else if q.type === 'repeating_service'}
            <!-- Goods & Services repeater (Q2.3) -->
            <div class="space-y-6">
              {#each Array.from({length: q.maxItems || 3}, (_, i) => i + 1) as idx}
              <div class="bg-[var(--color-background)] rounded-xl p-5 border border-[var(--color-border-light)]">
                <div class="text-sm font-semibold text-[var(--color-primary)] mb-4">Good or Service #{idx}</div>
                <div class="mb-4">
                  <label class="text-sm text-[var(--color-text-secondary)] block mb-1">Description</label>
                  <textarea
                    value={allAnswers[q.id + '_s' + idx + '_desc']?.value || ''}
                    oninput={(e) => handleAnswer(q.id + '_s' + idx + '_desc', (e.target as HTMLTextAreaElement).value)}
                    rows="3" placeholder="Describe this good or service..."
                    class="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-y"
                  ></textarea>
                </div>
                <div>
                  <label class="text-sm text-[var(--color-text-secondary)] block mb-2">Available to customers/users…</label>
                  <div class="space-y-1">
                    {#each [
                      { value: 'market_price', label: 'At a market price' },
                      { value: 'below_market', label: 'Below the market price' },
                      { value: 'above_market', label: 'Above the market price' },
                      { value: 'free', label: 'Free of charge' },
                      { value: 'other', label: 'Other' }
                    ] as opt}
                    {@const pKey = q.id + '_s' + idx + '_pricing'}
                    {@const pVal = (allAnswers[pKey]?.value as string[]) || []}
                    <button
                      onclick={() => {
                        const current = [...((allAnswers[pKey]?.value as string[]) || [])];
                        const ci = current.indexOf(opt.value);
                        if (ci >= 0) current.splice(ci, 1); else current.push(opt.value);
                        handleAnswer(pKey, current);
                      }}
                      class="w-full text-left px-3 py-2 rounded-lg border text-sm transition-all flex items-center gap-2
                        {pVal.includes(opt.value) ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'}"
                    >
                      <span class="w-4 h-4 rounded border flex items-center justify-center text-xs flex-shrink-0
                        {pVal.includes(opt.value) ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-[var(--color-border)]'}">
                        {#if pVal.includes(opt.value)}✓{/if}
                      </span>
                      {opt.label}
                    </button>
                    {/each}
                  </div>
                </div>
              </div>
              {/each}
            </div>

            {:else if q.type === 'nace_selector'}
            <!-- NACE code selector (simplified as text inputs) -->
            <div class="space-y-3">
              <p class="text-xs text-[var(--color-text-secondary)]">Enter up to {q.maxSelections || 3} NACE codes and descriptions, ranked by importance.</p>
              {#each Array.from({length: q.maxSelections || 3}, (_, i) => i + 1) as idx}
              <div class="flex items-center gap-3">
                <span class="text-sm font-mono text-[var(--color-primary)] w-6 flex-shrink-0">{idx}.</span>
                <input type="text"
                  value={allAnswers[q.id + '_' + idx]?.value || ''}
                  oninput={(e) => handleAnswer(q.id + '_' + idx, (e.target as HTMLInputElement).value)}
                  placeholder="e.g. 38.32 — Recovery of sorted materials"
                  class="flex-1 h-10 px-3 border border-[var(--color-border)] rounded-lg text-sm"
                />
              </div>
              {/each}
            </div>

            {:else if q.type === 'net_income'}
            <!-- Net income/loss (Q4.21) -->
            <div class="space-y-3">
              <div class="flex gap-3">
                {#each [
                  { value: 'income', label: 'Net income (+)' },
                  { value: 'loss', label: 'Net loss (−)' },
                  { value: 'na', label: 'N/A' }
                ] as opt}
                <button
                  onclick={() => handleAnswer(q.id + '_type', opt.value)}
                  class="flex-1 h-12 rounded-xl border-2 font-medium text-sm transition-all
                    {allAnswers[q.id + '_type']?.value === opt.value
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]'}"
                >{opt.label}</button>
                {/each}
              </div>
              {#if allAnswers[q.id + '_type']?.value && allAnswers[q.id + '_type']?.value !== 'na'}
              <div class="flex items-center gap-2">
                <span class="text-[var(--color-text-secondary)] font-mono text-sm">{allAnswers['Q4.1']?.value || '€'}</span>
                <input type="number"
                  value={allAnswers[q.id + '_amount']?.value ?? ''}
                  oninput={(e) => handleAnswer(q.id + '_amount', (e.target as HTMLInputElement).value ? Number((e.target as HTMLInputElement).value) : null)}
                  class="flex-1 h-12 px-4 border border-[var(--color-border)] rounded-lg text-right font-mono"
                />
              </div>
              {/if}
            </div>

            {:else if q.type === 'governance_bodies'}
            <!-- Governance bodies repeater (Q3.13) -->
            <div class="space-y-4">
              <div class="flex gap-3 mb-2">
                <button onclick={() => handleAnswer(q.id + '_has', 'yes')}
                  class="flex-1 h-12 rounded-xl border-2 font-semibold transition-all
                    {allAnswers[q.id + '_has']?.value === 'yes' ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}">
                  Yes
                </button>
                <button onclick={() => handleAnswer(q.id + '_has', 'no')}
                  class="flex-1 h-12 rounded-xl border-2 font-semibold transition-all
                    {allAnswers[q.id + '_has']?.value === 'no' ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}">
                  No
                </button>
              </div>
              {#if allAnswers[q.id + '_has']?.value === 'yes'}
              {#each Array.from({length: q.maxItems || 2}, (_, i) => i + 1) as idx}
              <div class="bg-[var(--color-background)] rounded-xl p-5 border border-[var(--color-border-light)]">
                <div class="text-sm font-semibold text-[var(--color-primary)] mb-3">Governance Body {idx}</div>
                <div class="mb-3">
                  <label class="text-sm text-[var(--color-text-secondary)] block mb-1">Name</label>
                  <input type="text"
                    value={allAnswers[q.id + '_b' + idx + '_name']?.value || ''}
                    oninput={(e) => handleAnswer(q.id + '_b' + idx + '_name', (e.target as HTMLInputElement).value)}
                    class="w-full h-10 px-3 border border-[var(--color-border)] rounded-lg text-sm"
                  />
                </div>
                <div class="mb-3">
                  <label class="text-sm text-[var(--color-text-secondary)] block mb-1">Mission or role</label>
                  <textarea
                    value={allAnswers[q.id + '_b' + idx + '_mission']?.value || ''}
                    oninput={(e) => handleAnswer(q.id + '_b' + idx + '_mission', (e.target as HTMLTextAreaElement).value)}
                    rows="2" class="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-y"
                  ></textarea>
                </div>
                <div>
                  <label class="text-sm text-[var(--color-text-secondary)] block mb-1">Most represented groups (max 3, by importance)</label>
                  {#each [1,2,3] as rank}
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-xs font-mono text-[var(--color-primary)] w-4">{rank}.</span>
                    <input type="text"
                      value={allAnswers[q.id + '_b' + idx + '_group' + rank]?.value || ''}
                      oninput={(e) => handleAnswer(q.id + '_b' + idx + '_group' + rank, (e.target as HTMLInputElement).value)}
                      class="flex-1 h-9 px-3 border border-[var(--color-border)] rounded-lg text-sm"
                    />
                  </div>
                  {/each}
                </div>
              </div>
              {/each}
              {/if}
            </div>

            {:else if q.type === 'networks'}
            <!-- Networks repeater (Q3.14) -->
            <div class="space-y-4">
              <div class="flex gap-3 mb-2">
                <button onclick={() => handleAnswer(q.id + '_has', 'yes')}
                  class="flex-1 h-12 rounded-xl border-2 font-semibold transition-all
                    {allAnswers[q.id + '_has']?.value === 'yes' ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}">
                  Yes
                </button>
                <button onclick={() => handleAnswer(q.id + '_has', 'no')}
                  class="flex-1 h-12 rounded-xl border-2 font-semibold transition-all
                    {allAnswers[q.id + '_has']?.value === 'no' ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}">
                  No
                </button>
              </div>
              {#if allAnswers[q.id + '_has']?.value === 'yes'}
              {#each Array.from({length: q.maxItems || 3}, (_, i) => i + 1) as idx}
              <div class="bg-[var(--color-background)] rounded-xl p-5 border border-[var(--color-border-light)]">
                <div class="text-sm font-semibold text-[var(--color-primary)] mb-3">Network {idx}</div>
                <div class="mb-3">
                  <label class="text-sm text-[var(--color-text-secondary)] block mb-1">Name in the country's language</label>
                  <input type="text"
                    value={allAnswers[q.id + '_n' + idx + '_local']?.value || ''}
                    oninput={(e) => handleAnswer(q.id + '_n' + idx + '_local', (e.target as HTMLInputElement).value)}
                    class="w-full h-10 px-3 border border-[var(--color-border)] rounded-lg text-sm"
                  />
                </div>
                <div class="mb-3">
                  <label class="text-sm text-[var(--color-text-secondary)] block mb-1">Translation in English</label>
                  <input type="text"
                    value={allAnswers[q.id + '_n' + idx + '_english']?.value || ''}
                    oninput={(e) => handleAnswer(q.id + '_n' + idx + '_english', (e.target as HTMLInputElement).value)}
                    class="w-full h-10 px-3 border border-[var(--color-border)] rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label class="text-sm text-[var(--color-text-secondary)] block mb-2">Main purposes</label>
                  {#each [
                    { value: 'advocacy', label: 'Advocacy' },
                    { value: 'services', label: 'Providing services (technical support, financial services…)' },
                    { value: 'information', label: 'Information sharing' },
                    { value: 'other', label: 'Other' }
                  ] as opt}
                  {@const pKey = q.id + '_n' + idx + '_purposes'}
                  {@const pVal = (allAnswers[pKey]?.value as string[]) || []}
                  <button
                    onclick={() => {
                      const cur = [...((allAnswers[pKey]?.value as string[]) || [])];
                      const ci = cur.indexOf(opt.value);
                      if (ci >= 0) cur.splice(ci, 1); else cur.push(opt.value);
                      handleAnswer(pKey, cur);
                    }}
                    class="w-full text-left px-3 py-2 rounded-lg border text-sm mb-1 transition-all flex items-center gap-2
                      {pVal.includes(opt.value) ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border)]'}"
                  >
                    <span class="w-4 h-4 rounded border flex items-center justify-center text-xs flex-shrink-0
                      {pVal.includes(opt.value) ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-[var(--color-border)]'}">
                      {#if pVal.includes(opt.value)}✓{/if}
                    </span>
                    {opt.label}
                  </button>
                  {/each}
                </div>
              </div>
              {/each}
              {/if}
            </div>

            {:else if q.type === 'policy_form'}
            <!-- Policy form (Q4.18.x, Q4.19.x) -->
            <div class="bg-[var(--color-background)] rounded-xl p-5 border border-[var(--color-border-light)] space-y-4">
              <div>
                <label class="text-sm text-[var(--color-text-secondary)] block mb-1">Name of the policy</label>
                <input type="text"
                  value={allAnswers[q.id + '_name']?.value || ''}
                  oninput={(e) => handleAnswer(q.id + '_name', (e.target as HTMLInputElement).value)}
                  class="w-full h-10 px-3 border border-[var(--color-border)] rounded-lg text-sm"
                />
              </div>
              <div>
                <label class="text-sm text-[var(--color-text-secondary)] block mb-2">Type of support</label>
                {#each (q.fields?.[1]?.options || []) as opt}
                {@const pKey = q.id + '_types'}
                {@const pVal = (allAnswers[pKey]?.value as string[]) || []}
                <button
                  onclick={() => {
                    const cur = [...((allAnswers[pKey]?.value as string[]) || [])];
                    const ci = cur.indexOf(opt.value);
                    if (ci >= 0) cur.splice(ci, 1); else cur.push(opt.value);
                    handleAnswer(pKey, cur);
                  }}
                  class="w-full text-left px-3 py-2 rounded-lg border text-sm mb-1 transition-all flex items-center gap-2
                    {pVal.includes(opt.value) ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border)]'}"
                >
                  <span class="w-4 h-4 rounded border flex items-center justify-center text-xs flex-shrink-0
                    {pVal.includes(opt.value) ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-[var(--color-border)]'}">
                    {#if pVal.includes(opt.value)}✓{/if}
                  </span>
                  {opt.label}
                </button>
                {/each}
              </div>
              <div>
                <label class="text-sm text-[var(--color-text-secondary)] block mb-1">Criteria or conditions</label>
                <textarea
                  value={allAnswers[q.id + '_criteria']?.value || ''}
                  oninput={(e) => handleAnswer(q.id + '_criteria', (e.target as HTMLTextAreaElement).value)}
                  rows="2" class="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-y"
                ></textarea>
              </div>
              <div>
                <label class="text-sm text-[var(--color-text-secondary)] block mb-1">Legal basis</label>
                <input type="text"
                  value={allAnswers[q.id + '_legal']?.value || ''}
                  oninput={(e) => handleAnswer(q.id + '_legal', (e.target as HTMLInputElement).value)}
                  class="w-full h-10 px-3 border border-[var(--color-border)] rounded-lg text-sm"
                />
              </div>
            </div>

            {:else if q.type === 'ranking_text'}
            <!-- Ranked text list -->
            <div class="space-y-2">
              {#each Array.from({length: q.maxItems || 5}, (_, i) => i + 1) as rank}
              <div class="flex items-center gap-2">
                <span class="text-sm font-mono text-[var(--color-primary)] w-6 flex-shrink-0 text-right">{rank}.</span>
                <input type="text"
                  value={allAnswers[q.id + '_rank' + rank]?.value || ''}
                  oninput={(e) => handleAnswer(q.id + '_rank' + rank, (e.target as HTMLInputElement).value)}
                  placeholder="Most {rank === 1 ? 'important' : rank === 2 ? 'second most important' : 'next'}..."
                  class="flex-1 h-10 px-3 border border-[var(--color-border)] rounded-lg text-sm"
                />
              </div>
              {/each}
            </div>

            {:else if q.type === 'board_matrix'}
            <!-- Board composition — repeating member rows -->
            <div class="space-y-3">
              <p class="text-xs text-[var(--color-text-secondary)]">Add board members. Mark up to 3 as most influential.</p>
              {#each Array.from({length: 8}, (_, i) => i + 1) as idx}
              <div class="flex flex-col sm:flex-row gap-2 bg-[var(--color-background)] rounded-lg p-3 {allAnswers[q.id + '_m' + idx + '_name']?.value ? '' : 'opacity-60'}">
                <input type="text"
                  value={allAnswers[q.id + '_m' + idx + '_name']?.value || ''}
                  oninput={(e) => handleAnswer(q.id + '_m' + idx + '_name', (e.target as HTMLInputElement).value)}
                  placeholder="Member {idx} name / role"
                  class="flex-1 h-9 px-3 border border-[var(--color-border)] rounded-lg text-sm"
                />
                <input type="number" min="0"
                  value={allAnswers[q.id + '_m' + idx + '_count']?.value ?? ''}
                  oninput={(e) => handleAnswer(q.id + '_m' + idx + '_count', (e.target as HTMLInputElement).value ? Number((e.target as HTMLInputElement).value) : null)}
                  placeholder="# persons"
                  class="w-24 h-9 px-3 border border-[var(--color-border)] rounded-lg text-sm text-right font-mono"
                />
                <label class="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] flex-shrink-0">
                  <input type="checkbox"
                    checked={allAnswers[q.id + '_m' + idx + '_influential']?.value === true}
                    onchange={(e) => handleAnswer(q.id + '_m' + idx + '_influential', (e.target as HTMLInputElement).checked)}
                    class="w-4 h-4 rounded"
                  />
                  Influential
                </label>
              </div>
              {/each}
            </div>

            {:else if q.type === 'board_sector_matrix'}
            <!-- Board sector classification -->
            <div class="space-y-3">
              {#each q.sectors as sector}
              <div class="flex flex-col sm:flex-row sm:items-center gap-2 bg-[var(--color-background)] rounded-lg p-3">
                <span class="flex-1 text-sm text-[var(--color-text)]">{sector.label}</span>
                <div class="flex items-center gap-3">
                  <div class="flex items-center gap-1">
                    <span class="text-xs text-[var(--color-text-secondary)]"># persons</span>
                    <input type="number" min="0"
                      value={allAnswers[q.id + '_' + sector.value + '_count']?.value ?? ''}
                      oninput={(e) => handleAnswer(q.id + '_' + sector.value + '_count', (e.target as HTMLInputElement).value ? Number((e.target as HTMLInputElement).value) : null)}
                      class="w-20 h-9 px-2 border border-[var(--color-border)] rounded-lg text-sm text-right font-mono"
                    />
                  </div>
                  <label class="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] flex-shrink-0">
                    <input type="radio" name={q.id + '_influential'}
                      checked={allAnswers[q.id + '_influential']?.value === sector.value}
                      onchange={() => handleAnswer(q.id + '_influential', sector.value)}
                      class="w-4 h-4"
                    />
                    Most influential
                  </label>
                </div>
              </div>
              {/each}
            </div>

            {:else}
            <!-- Fallback for any remaining types -->
            <textarea
              value={allAnswers[q.id]?.value || ''}
              oninput={(e) => handleAnswer(q.id, (e.target as HTMLTextAreaElement).value)}
              rows="4"
              class="w-full px-4 py-3 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] bg-[var(--color-surface)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-light)] outline-none resize-y"
            ></textarea>
            {/if}

            {/if}
            <!-- end N/A wrapper -->
          </div>
          {/each}
        </div>

        <!-- Navigation buttons -->
        <div class="flex items-center justify-between mt-8 sm:mt-10 pb-8 sm:pb-10 gap-2">
          <button
            onclick={prevGroup}
            disabled={isFirstGroup}
            class="px-3 sm:px-6 h-11 sm:h-12 rounded-xl border-2 border-[var(--color-border)] text-[var(--color-text-secondary)] font-medium text-sm sm:text-base hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← <span class="hidden sm:inline">Previous</span>
          </button>

          <span class="text-xs sm:text-sm text-[var(--color-text-secondary)] text-center">
            {prog.overall.percent}%
          </span>

          {#if isLastGroup}
          <button
            onclick={() => currentPage.set('review')}
            class="px-3 sm:px-6 h-11 sm:h-12 rounded-xl bg-[var(--color-accent)] text-white font-semibold text-sm sm:text-base hover:bg-[var(--color-accent)]/90 transition-all shadow-sm"
          >
            Review<span class="hidden sm:inline"> Answers</span> →
          </button>
          {:else}
          <button
            onclick={handleNextGroup}
            class="px-4 sm:px-6 h-11 sm:h-12 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm sm:text-base hover:bg-[var(--color-primary-dark)] transition-all shadow-sm"
          >
            Next →
          </button>
          {/if}
        </div>
      </div>
    </div>
  </main>
</div>

<!-- REVIEW PAGE -->
{:else if page === 'review'}
<div class="min-h-screen bg-[var(--color-background)]">
  <header class="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2">
    <button onclick={() => currentPage.set('questionnaire')} class="text-xs sm:text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] flex-shrink-0">
      ← <span class="hidden sm:inline">Back to questionnaire</span><span class="sm:hidden">Back</span>
    </button>
    <h1 class="text-sm sm:text-lg font-semibold text-[var(--color-text)] truncate">Review</h1>
    <div class="flex gap-1.5 sm:gap-2 flex-shrink-0">
      <button onclick={handleExportPDF}
        class="px-2.5 sm:px-4 h-9 sm:h-10 rounded-lg bg-[var(--color-success)] text-white text-xs sm:text-sm font-medium hover:opacity-90 transition-colors">
        PDF
      </button>
      <button onclick={handleExportJSON}
        class="px-2.5 sm:px-4 h-9 sm:h-10 rounded-lg bg-[var(--color-primary)] text-white text-xs sm:text-sm font-medium hover:bg-[var(--color-primary-dark)] transition-colors">
        JSON
      </button>
      <button onclick={handleExportCSV}
        class="px-2.5 sm:px-4 h-9 sm:h-10 rounded-lg bg-[var(--color-accent)] text-white text-xs sm:text-sm font-medium hover:opacity-90 transition-colors">
        CSV
      </button>
    </div>
  </header>

  <div class="max-w-[720px] mx-auto px-3 sm:px-6 py-6 sm:py-10">
    <!-- Overall stats -->
    <div class="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 sm:p-6 mb-6 sm:mb-8">
      <h2 class="text-lg sm:text-xl font-bold mb-3 sm:mb-4">Completion Summary</h2>
      <div class="grid grid-cols-4 gap-2 sm:gap-4">
        {#each sections as sec}
        <div class="text-center">
          <div class="text-lg sm:text-2xl font-bold {prog.sections[sec.id]?.percent === 100 ? 'text-[var(--color-success)]' : 'text-[var(--color-primary)]'}">
            {prog.sections[sec.id]?.percent || 0}%
          </div>
          <div class="text-[10px] sm:text-xs text-[var(--color-text-secondary)] mt-0.5 sm:mt-1">Sec. {sec.number}</div>
        </div>
        {/each}
      </div>
      <div class="mt-3 sm:mt-4 h-2 bg-[var(--color-border-light)] rounded-full overflow-hidden">
        <div class="h-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-accent)] rounded-full transition-all" style="width: {prog.overall.percent}%"></div>
      </div>
      <p class="text-center text-xs sm:text-sm text-[var(--color-text-secondary)] mt-2">{prog.overall.answered} of {prog.overall.total} answered ({prog.overall.percent}%)</p>
    </div>

    <!-- All questions by section -->
    {#each sections as sec, si}
    <div class="mb-8">
      <h3 class="text-lg font-bold text-[var(--color-text)] mb-4">Section {sec.number}: {sec.title}</h3>
      {#each sec.groups as grp, gi}
      <div class="mb-4">
        <h4 class="text-sm font-semibold text-[var(--color-primary)] mb-2">{grp.title}</h4>
        {#each grp.questions as qid}
        {#if visible.has(qid)}
        {@const q = (questionnaire.questions as any)[qid]}
        {#if q}
        <div class="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 py-2 border-b border-[var(--color-border-light)]">
          <div class="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
            <span class="text-[10px] sm:text-xs font-mono text-[var(--color-text-secondary)] w-10 sm:w-12 flex-shrink-0">{q.number}</span>
            <span class="flex-1 text-xs sm:text-sm text-[var(--color-text)]">{q.text}</span>
          </div>
          <span class="text-xs sm:text-sm sm:text-right flex-shrink-0 sm:max-w-48 truncate pl-12 sm:pl-0
            {allAnswers[qid]?.value ? 'text-[var(--color-success)] font-medium' : 'text-[var(--color-error)]'}">
            {#if allAnswers[qid]?.value}
              {#if typeof allAnswers[qid].value === 'object'}
                ✓ Answered
              {:else}
                {allAnswers[qid].value}
              {/if}
            {:else}
              Not answered
            {/if}
          </span>
        </div>
        {/if}
        {/if}
        {/each}
      </div>
      {/each}
    </div>
    {/each}

    <!-- Export buttons -->
    <div class="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 justify-center mt-8 sm:mt-10 pb-8 sm:pb-10">
      <button onclick={handleExportPDF}
        class="px-6 h-12 rounded-xl bg-[var(--color-success)] text-white font-semibold text-sm sm:text-base hover:opacity-90 transition-all shadow-sm w-full sm:w-auto">
        Download PDF
      </button>
      <button onclick={handleExportJSON}
        class="px-6 h-12 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm sm:text-base hover:bg-[var(--color-primary-dark)] transition-all shadow-sm w-full sm:w-auto">
        Download JSON
      </button>
      <button onclick={handleExportCSV}
        class="px-6 h-12 rounded-xl bg-[var(--color-accent)] text-white font-semibold text-sm sm:text-base hover:opacity-90 transition-all shadow-sm w-full sm:w-auto">
        Download CSV
      </button>
      <button onclick={() => currentPage.set('questionnaire')}
        class="px-6 h-12 rounded-xl border-2 border-[var(--color-border)] text-[var(--color-text-secondary)] font-medium text-sm sm:text-base hover:border-[var(--color-primary)] transition-all w-full sm:w-auto">
        Back to editing
      </button>
    </div>
  </div>
</div>
{/if}
