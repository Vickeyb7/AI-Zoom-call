import { jsPDF } from 'jspdf';
import {
  classifySentimentTone,
  deriveSentimentSegments,
  type SentimentChartPoint,
} from '../components/SentimentTimelineChart';
import type {
  MeetingSession,
  MeetingStakeholderSummary,
  SentimentTimelineSegment,
} from '../types/sales';

interface TranscriptHighlight {
  speaker: string;
  timestamp: string;
  text: string;
  label?: string;
}

/**
 * Normalizes typography so built-in jsPDF Helvetica (WinAnsi) renders cleanly
 * across all PDF viewers without broken unicode glyphs.
 */
function pdfText(input: string | undefined | null): string {
  if (!input) return '';
  return input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2014/g, ' - ')
    .replace(/\u2013/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00B7/g, ' | ')
    .replace(/\u2022/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugifyFileName(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'meeting'
  );
}

function toneRgb(tone: SentimentTimelineSegment['tone']): [number, number, number] {
  if (tone === 'Constructive') return [5, 150, 105];
  if (tone === 'Neutral') return [79, 70, 229];
  if (tone === 'Cautious') return [217, 119, 6];
  return [225, 29, 72];
}

function extractTranscriptHighlights(meeting: MeetingSession): {
  highlights: TranscriptHighlight[];
  fromSignalsFallback: boolean;
} {
  const turns = meeting.transcript || [];
  if (turns.length > 0) {
    // Score turns to surface tagged moments, strong sentiment shifts, questions, and bookends
    const scored = turns.map((turn, idx) => {
      let weight = 0;
      if (turn.detectedTags && turn.detectedTags.length > 0) weight += 4;
      if (Math.abs(turn.sentimentScore || 0) >= 0.25) weight += 2;
      if (turn.speaker === 'Prospect') weight += 1;
      if (turn.text.includes('?')) weight += 1;
      if (idx === 0 || idx === turns.length - 1) weight += 1;
      return { turn, idx, weight };
    });

    const selectedIndices = new Set<number>(
      scored
        .sort((a, b) => b.weight - a.weight || a.idx - b.idx)
        .slice(0, 10)
        .map((s) => s.idx),
    );

    const highlights: TranscriptHighlight[] = turns
      .map((turn, idx) => ({ turn, idx }))
      .filter(({ idx }) => selectedIndices.has(idx))
      .map(({ turn }) => ({
        speaker: pdfText(turn.speakerName || turn.speaker),
        timestamp: pdfText(turn.timestamp),
        text: pdfText(turn.text),
        label:
          turn.detectedTags && turn.detectedTags.length > 0
            ? turn.detectedTags.map((t) => `#${pdfText(t)}`).join('  ')
            : undefined,
      }));

    return { highlights, fromSignalsFallback: false };
  }

  // Fallback when raw transcripts were purged under privacy-first retention (TRANSCRIPT_RETENTION_DAYS=0)
  const seen = new Set<string>();
  const highlights: TranscriptHighlight[] = [];

  for (const sig of meeting.signals || []) {
    const excerpt = pdfText(sig.evidenceExcerpt);
    if (!excerpt || seen.has(excerpt.toLowerCase())) continue;
    seen.add(excerpt.toLowerCase());
    highlights.push({
      speaker: pdfText(sig.excerpts?.[0]?.speakerName || 'Prospect'),
      timestamp: pdfText(sig.excerpts?.[0]?.timestamp || sig.createdAt.slice(0, 10)),
      text: excerpt,
      label: pdfText(sig.entityName ? `${sig.category} (${sig.entityName})` : sig.category),
    });
  }

  for (const ins of meeting.insights || []) {
    const excerpt = pdfText(ins.trigger?.transcriptExcerpt);
    if (!excerpt || seen.has(excerpt.toLowerCase())) continue;
    seen.add(excerpt.toLowerCase());
    highlights.push({
      speaker: pdfText(ins.trigger?.speakerName || ins.trigger?.speaker || 'Prospect'),
      timestamp: pdfText(ins.trigger?.timestamp || ''),
      text: excerpt,
      label: pdfText(ins.objectionCategory || ins.title),
    });
  }

  return { highlights: highlights.slice(0, 10), fromSignalsFallback: true };
}

export function exportMeetingReportPdf(
  meeting: MeetingSession,
  stakeholders: MeetingStakeholderSummary[] = [],
): string {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 44;
  const contentWidth = pageWidth - marginX * 2;
  const bottomLimit = pageHeight - 54;
  let y = 0;

  const ensureSpace = (neededPt: number) => {
    if (y + neededPt > bottomLimit) {
      doc.addPage();
      y = 48;
    }
  };

  const drawSectionHeading = (title: string, subtitle?: string) => {
    ensureSpace(34);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(15, 23, 42);
    doc.text(pdfText(title), marginX, y);

    if (subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(pdfText(subtitle), pageWidth - marginX, y, { align: 'right' });
    }

    y += 5;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.75);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 14;
  };

  const drawBulletList = (items: string[], accentRgb: [number, number, number] = [79, 70, 229]) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 41, 59);

    for (const rawItem of items) {
      const clean = pdfText(rawItem);
      if (!clean) continue;
      const lines = doc.splitTextToSize(clean, contentWidth - 16) as string[];
      const blockHeight = lines.length * 13 + 5;
      ensureSpace(blockHeight);

      doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.circle(marginX + 4, y - 3, 2, 'F');
      doc.text(lines, marginX + 14, y);
      y += blockHeight;
    }
  };

  // =========================================================================
  // 1. HEADER BAND
  // =========================================================================
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 88, 'F');
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, pageWidth, 4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(165, 180, 252);
  doc.text('MEETING INTELLIGENCE REPORT', marginX, 26);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  const accountTitle = pdfText(meeting.accountName);
  doc.text(accountTitle.slice(0, 56), marginX, 48);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225);
  const subtitleLines = doc.splitTextToSize(pdfText(meeting.title), contentWidth - 150) as string[];
  doc.text(subtitleLines[0] || '', marginX, 66);

  // Right-aligned metadata in header
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  const dateStr = pdfText(meeting.startedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10));
  doc.text(`${dateStr}  |  ${pdfText(meeting.stage)}`, pageWidth - marginX, 44, {
    align: 'right',
  });
  doc.text(
    `${pdfText(meeting.platform)}  |  Status: ${pdfText(meeting.status).toUpperCase()}`,
    pageWidth - marginX,
    58,
    { align: 'right' },
  );

  y = 108;

  // =========================================================================
  // 2. EXECUTIVE TELEMETRY STRIP & PARTICIPANTS
  // =========================================================================
  const coveredMeddpicc = meeting.qualification.filter((q) => q.covered).length;
  const kpis = [
    { label: 'Deal Value', value: `$${meeting.dealValue.toLocaleString()}` },
    {
      label: 'Talk Ratio',
      value: `Rep ${meeting.aeTalkRatio}% / Pros ${meeting.prospectTalkRatio}%`,
    },
    {
      label: 'MEDDPICC Covered',
      value: `${coveredMeddpicc} / ${meeting.qualification.length} fields`,
    },
    {
      label: 'Signals Detected',
      value: `${meeting.signals.length} (${meeting.suppressedDuplicatesCount} merged)`,
    },
  ];

  const kpiWidth = contentWidth / kpis.length;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.75);
  doc.roundedRect(marginX, y, contentWidth, 42, 4, 4, 'FD');

  kpis.forEach((kpi, idx) => {
    const x = marginX + idx * kpiWidth;
    if (idx > 0) {
      doc.setDrawColor(226, 232, 240);
      doc.line(x, y + 6, x, y + 36);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, x + 10, y + 16);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(pdfText(kpi.value), x + 10, y + 31);
  });

  y += 56;

  // Participants & Primary Competitor line
  const participantNames =
    stakeholders.length > 0
      ? stakeholders.map((s) => `${pdfText(s.name)} (${pdfText(s.role)})`)
      : (meeting.prospectStakeholders || []).map((p) => pdfText(p));

  const metaPairs: string[] = [];
  if (meeting.aeName) metaPairs.push(`Account Executive: ${pdfText(meeting.aeName)}`);
  if (meeting.primaryCompetitor) {
    metaPairs.push(`Primary Competitor: ${pdfText(meeting.primaryCompetitor)}`);
  }
  if (participantNames.length > 0) {
    metaPairs.push(`Participants: ${participantNames.join(', ')}`);
  }

  if (metaPairs.length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.8);
    doc.setTextColor(71, 85, 105);
    for (const line of metaPairs) {
      const wrapped = doc.splitTextToSize(line, contentWidth) as string[];
      doc.text(wrapped, marginX, y);
      y += wrapped.length * 12 + 2;
    }
    y += 8;
  }

  // =========================================================================
  // 3. EXECUTIVE RECAP & KEY DECISIONS
  // =========================================================================
  if (meeting.executiveSummary) {
    const summary = meeting.executiveSummary;
    drawSectionHeading(
      'Executive Recap & Key Decisions',
      summary.generatedAt ? `Synthesized ${summary.generatedAt.slice(0, 10)}` : undefined,
    );

    if (summary.keyDecisions && summary.keyDecisions.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(67, 56, 202);
      doc.text('Key Decisions', marginX, y);
      y += 13;
      drawBulletList(summary.keyDecisions, [79, 70, 229]);
      y += 4;
    }

    if (summary.facts && summary.facts.length > 0) {
      ensureSpace(24);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      doc.text('Observed Facts', marginX, y);
      y += 13;
      drawBulletList(summary.facts, [100, 116, 139]);
      y += 4;
    }

    if (summary.nextSteps && summary.nextSteps.length > 0) {
      ensureSpace(24);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(5, 150, 105);
      doc.text('Recommended Next Steps', marginX, y);
      y += 13;
      drawBulletList(summary.nextSteps, [5, 150, 105]);
      y += 6;
    }
  }

  // =========================================================================
  // 4. SENTIMENT ANALYSIS TIMELINE (VECTOR CHART + SEGMENT FLOW)
  // =========================================================================
  const segments: SentimentChartPoint[] = deriveSentimentSegments(meeting);
  if (segments.length > 0) {
    const avgScore = Math.round(
      segments.reduce((acc, s) => acc + s.score, 0) / segments.length,
    );
    const overallTone = classifySentimentTone(avgScore);
    const opening = segments[0];
    const closing = segments[segments.length - 1];
    const netShift = closing.score - opening.score;
    const shiftText = `${netShift > 0 ? `+${netShift}` : netShift} pts shift`;

    ensureSpace(175);
    drawSectionHeading(
      'Sentiment Analysis Timeline',
      `Avg ${avgScore}% (${overallTone})  |  ${shiftText}`,
    );

    const chartBoxX = marginX;
    const chartBoxY = y;
    const chartBoxW = contentWidth;
    const chartBoxH = 122;

    // Outer frame
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.75);
    doc.roundedRect(chartBoxX, chartBoxY, chartBoxW, chartBoxH, 4, 4, 'FD');

    const plotLeft = chartBoxX + 36;
    const plotRight = chartBoxX + chartBoxW - 18;
    const plotTop = chartBoxY + 18;
    const plotBottom = chartBoxY + chartBoxH - 26;
    const plotW = plotRight - plotLeft;
    const plotH = plotBottom - plotTop;

    const yForScore = (score: number) =>
      plotBottom - (Math.max(0, Math.min(100, score)) / 100) * plotH;

    // Horizontal grid lines (0%, 50%, 100%)
    for (const tick of [0, 50, 100]) {
      const ty = yForScore(tick);
      doc.setDrawColor(tick === 50 ? 148 : 226, tick === 50 ? 163 : 232, tick === 50 ? 184 : 240);
      doc.setLineWidth(tick === 50 ? 0.65 : 0.45);
      doc.line(plotLeft, ty, plotRight, ty);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`${tick}%`, plotLeft - 6, ty + 2.5, { align: 'right' });
    }

    // Compute coordinates for each segment
    const coords = segments.map((seg, idx) => {
      const px =
        segments.length === 1
          ? plotLeft + plotW / 2
          : plotLeft + (idx / (segments.length - 1)) * plotW;
      const py = yForScore(seg.score);
      return { x: px, y: py, seg };
    });

    // Subtle shaded vertical drop guides + connecting indigo trend line
    doc.setDrawColor(79, 70, 229);
    doc.setLineWidth(1.6);
    for (let i = 0; i < coords.length - 1; i++) {
      doc.line(coords[i].x, coords[i].y, coords[i + 1].x, coords[i + 1].y);
    }

    // Points, score labels, and x-axis labels
    coords.forEach(({ x: px, y: py, seg }) => {
      const [r, g, b] = toneRgb(seg.tone);
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(1.5);
      doc.circle(px, py, 3.6, 'FD');

      doc.setFillColor(r, g, b);
      doc.circle(px, py, 2.2, 'F');

      // Score value above dot
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(r, g, b);
      const scoreLabelY = py < plotTop + 12 ? py + 11 : py - 6;
      doc.text(`${seg.score}%`, px, scoreLabelY, { align: 'center' });

      // X-axis segment label
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      const shortLabel = pdfText(seg.label).slice(0, 16);
      doc.text(shortLabel, px, plotBottom + 13, { align: 'center' });
    });

    y = chartBoxY + chartBoxH + 12;

    // Compact segment detail lines
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    for (const seg of segments) {
      ensureSpace(15);
      const [r, g, b] = toneRgb(seg.tone);
      const parts = [
        `${seg.index}. ${pdfText(seg.label)}`,
        seg.timeRange ? `(${pdfText(seg.timeRange)})` : '',
        `- ${seg.score}% ${seg.tone}`,
        seg.topic ? `| Topic: ${pdfText(seg.topic)}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      doc.setTextColor(r, g, b);
      doc.text('>', marginX + 2, y);
      doc.setTextColor(51, 65, 85);
      const wrapped = doc.splitTextToSize(parts, contentWidth - 14) as string[];
      doc.text(wrapped, marginX + 12, y);
      y += wrapped.length * 11.5 + 2.5;
    }

    y += 10;
  }

  // =========================================================================
  // 5. MEETING NOTES (PINNED CALL NOTES + STAKEHOLDER NOTES)
  // =========================================================================
  const pinnedNotes = meeting.scratchpad || [];
  const stakeholderNotes = stakeholders.flatMap((person) =>
    (person.historicalNotes || [])
      .filter((n) => n.meetingId === meeting.id || n.source === 'live_note')
      .map((n) => ({
        title: `${pdfText(person.name)} (${pdfText(person.role)})`,
        createdAt: pdfText(n.createdAt),
        text: pdfText(n.text),
      })),
  );

  drawSectionHeading(
    'Meeting Notes',
    `${pinnedNotes.length + stakeholderNotes.length} recorded`,
  );

  if (pinnedNotes.length === 0 && stakeholderNotes.length === 0) {
    ensureSpace(18);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('No manual or pinned notes were recorded during this meeting.', marginX, y);
    y += 20;
  } else {
    const allNotes = [
      ...pinnedNotes.map((n) => ({
        title: pdfText(n.sourceTitle || 'Pinned Note'),
        createdAt: pdfText(n.createdAt),
        text: pdfText(n.text),
      })),
      ...stakeholderNotes,
    ];

    for (const note of allNotes) {
      const textLines = doc.splitTextToSize(note.text, contentWidth - 18) as string[];
      const cardHeight = 18 + textLines.length * 12.5 + 8;
      ensureSpace(cardHeight + 6);

      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.6);
      doc.roundedRect(marginX, y, contentWidth, cardHeight, 3, 3, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(51, 65, 85);
      doc.text(note.title, marginX + 9, y + 13);

      if (note.createdAt) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(note.createdAt, pageWidth - marginX - 9, y + 13, { align: 'right' });
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.2);
      doc.setTextColor(15, 23, 42);
      doc.text(textLines, marginX + 9, y + 27);

      y += cardHeight + 7;
    }
    y += 6;
  }

  // =========================================================================
  // 6. TRANSCRIPT HIGHLIGHTS
  // =========================================================================
  const { highlights, fromSignalsFallback } = extractTranscriptHighlights(meeting);
  drawSectionHeading(
    'Transcript Highlights',
    fromSignalsFallback
      ? `${highlights.length} captured signal excerpts`
      : `${highlights.length} key moments`,
  );

  if (fromSignalsFallback) {
    ensureSpace(18);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.2);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Raw transcript lines were cleared per privacy-first retention policy. Verified signal and objection excerpts are summarized below.',
      marginX,
      y,
    );
    y += 16;
  }

  if (highlights.length === 0) {
    ensureSpace(18);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('No transcript turns or signal highlights are available for this meeting.', marginX, y);
    y += 18;
  } else {
    for (const item of highlights) {
      const quoteLines = doc.splitTextToSize(`"${item.text}"`, contentWidth - 16) as string[];
      const hasLabel = Boolean(item.label);
      const blockH = 14 + quoteLines.length * 12.5 + (hasLabel ? 12 : 0) + 8;
      ensureSpace(blockH);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.8);
      doc.setTextColor(15, 23, 42);
      doc.text(item.speaker, marginX, y);

      if (item.timestamp) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(item.timestamp, pageWidth - marginX, y, { align: 'right' });
      }

      y += 12;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.2);
      doc.setTextColor(30, 41, 59);
      doc.text(quoteLines, marginX + 6, y);
      y += quoteLines.length * 12.5;

      if (item.label) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.8);
        doc.setTextColor(79, 70, 229);
        doc.text(item.label, marginX + 6, y + 2);
        y += 12;
      }

      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.6);
      doc.line(marginX, y + 2, pageWidth - marginX, y + 2);
      y += 10;
    }
  }

  // =========================================================================
  // 7. RUNNING FOOTER ON EVERY PAGE
  // =========================================================================
  const totalPages = doc.getNumberOfPages();
  const exportedStamp = new Date().toISOString().slice(0, 10);
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(marginX, pageHeight - 36, pageWidth - marginX, pageHeight - 36);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `AI Sales Strategist  |  ${pdfText(meeting.accountName)}  |  Exported ${exportedStamp}`,
      marginX,
      pageHeight - 22,
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginX, pageHeight - 22, {
      align: 'right',
    });
  }

  const filename = `${slugifyFileName(meeting.accountName)}-meeting-report-${dateStr}.pdf`;
  doc.save(filename);
  return filename;
}
