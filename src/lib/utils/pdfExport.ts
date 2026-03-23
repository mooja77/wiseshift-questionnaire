import jsPDF from 'jspdf';
import 'jspdf-autotable';
import questionnaire from '$lib/data/questionnaire.json';
import type { AnswerMap } from '$lib/stores/answers';

export function generatePDF(answers: AnswerMap, visibleQuestions: Set<string>) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const wiseName = answers['Q1.1']?.value || 'Unknown WISE';
  const country = answers['Q4.1']?.value || '';

  // Helper: add page if needed
  function checkPage(needed: number = 20) {
    if (y + needed > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = margin;
    }
  }

  // === COVER PAGE ===
  doc.setFontSize(12);
  doc.setTextColor(45, 95, 138); // primary blue
  doc.text('WISESHIFT · Horizon Europe', pageWidth / 2, 50, { align: 'center' });

  doc.setFontSize(24);
  doc.setTextColor(44, 62, 80); // dark text
  doc.text('Organisational Overview', pageWidth / 2, 70, { align: 'center' });
  doc.text('Questionnaire', pageWidth / 2, 82, { align: 'center' });

  doc.setFontSize(14);
  doc.setTextColor(107, 123, 141);
  doc.text(wiseName, pageWidth / 2, 100, { align: 'center' });
  if (country) {
    doc.text(country, pageWidth / 2, 108, { align: 'center' });
  }

  doc.setFontSize(10);
  doc.text(`Exported: ${new Date().toLocaleDateString()}`, pageWidth / 2, 125, { align: 'center' });

  // Count answered
  let totalQ = 0, answeredQ = 0;
  for (const sec of questionnaire.sections) {
    for (const grp of sec.groups) {
      for (const qid of grp.questions) {
        if (visibleQuestions.has(qid)) {
          totalQ++;
          if (answers[qid]?.value !== undefined && answers[qid]?.value !== null && answers[qid]?.value !== '') {
            answeredQ++;
          }
        }
      }
    }
  }
  doc.text(`${answeredQ} of ${totalQ} questions answered (${Math.round(answeredQ / totalQ * 100)}%)`, pageWidth / 2, 135, { align: 'center' });

  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Grant Agreement No. 101178477. Views and opinions expressed are those of the author(s) only', pageWidth / 2, 270, { align: 'center' });
  doc.text('and do not necessarily reflect those of the European Union or the European Research Executive Agency (REA).', pageWidth / 2, 275, { align: 'center' });

  // === CONTENT PAGES ===
  for (const section of questionnaire.sections) {
    doc.addPage();
    y = margin;

    // Section header
    doc.setFontSize(16);
    doc.setTextColor(45, 95, 138);
    doc.text(`Section ${section.number}: ${section.title}`, margin, y);
    y += 12;

    for (const group of section.groups) {
      checkPage(25);

      // Group header
      doc.setFontSize(11);
      doc.setTextColor(45, 95, 138);
      doc.text(group.title, margin, y);
      y += 7;

      for (const qid of group.questions) {
        if (!visibleQuestions.has(qid)) continue;
        const q = (questionnaire.questions as any)[qid];
        if (!q) continue;

        checkPage(20);

        // Question number + text
        doc.setFontSize(9);
        doc.setTextColor(107, 123, 141);
        doc.text(q.number, margin, y);

        doc.setFontSize(10);
        doc.setTextColor(44, 62, 80);
        const qLines = doc.splitTextToSize(q.text, contentWidth - 15);
        doc.text(qLines, margin + 15, y);
        y += qLines.length * 5 + 2;

        // Answer
        const answer = answers[qid];
        const naAnswer = answers[qid + '__na'];

        doc.setFontSize(10);
        if (naAnswer?.value) {
          doc.setTextColor(150, 150, 150);
          doc.text('N/A', margin + 15, y);
        } else if (answer?.value !== undefined && answer?.value !== null && answer?.value !== '') {
          doc.setTextColor(58, 125, 92); // green
          let displayVal = '';
          if (typeof answer.value === 'object') {
            if (Array.isArray(answer.value)) {
              displayVal = answer.value.join(', ');
            } else {
              displayVal = Object.entries(answer.value).map(([k, v]) => `${k}: ${v}`).join(', ');
            }
          } else {
            displayVal = String(answer.value);
          }
          const aLines = doc.splitTextToSize(displayVal, contentWidth - 15);
          doc.text(aLines, margin + 15, y);
          y += (aLines.length - 1) * 5;
        } else {
          doc.setTextColor(192, 57, 43); // red
          doc.text('[Not answered]', margin + 15, y);
        }

        // Check for sub-answers (complex types)
        const subKeys = Object.keys(answers).filter(k => k.startsWith(qid + '_') && !k.endsWith('__na'));
        if (subKeys.length > 0 && !answer?.value) {
          y += 3;
          doc.setFontSize(9);
          doc.setTextColor(58, 125, 92);
          for (const sk of subKeys.slice(0, 10)) {
            const subVal = answers[sk]?.value;
            if (subVal !== undefined && subVal !== null && subVal !== '' && subVal !== false) {
              checkPage(8);
              const label = sk.replace(qid + '_', '').replace(/_/g, ' ');
              const sv = typeof subVal === 'object' ? JSON.stringify(subVal) : String(subVal);
              const sLines = doc.splitTextToSize(`${label}: ${sv}`, contentWidth - 20);
              doc.text(sLines, margin + 20, y);
              y += sLines.length * 4 + 1;
            }
          }
        }

        y += 6;
      }
      y += 3;
    }
  }

  // Footer on each page
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`WISESHIFT Questionnaire — ${wiseName}`, margin, doc.internal.pageSize.getHeight() - 10);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 10, { align: 'right' });
  }

  return doc;
}

export function downloadPDF(answers: AnswerMap, visibleQuestions: Set<string>) {
  const doc = generatePDF(answers, visibleQuestions);
  const wiseName = answers['Q1.1']?.value || 'WISE';
  const date = new Date().toISOString().split('T')[0];
  doc.save(`WISESHIFT_${wiseName.replace(/[^a-zA-Z0-9]/g, '_')}_${date}.pdf`);
}
