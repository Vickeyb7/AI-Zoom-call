import React from 'react';
import * as d3 from 'd3';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Play,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import type { MeetingSession } from '../types/sales';

export type TimelineMomentType =
  | 'sentiment_drop'
  | 'sentiment_lift'
  | 'objection'
  | 'competitor'
  | 'objection_resolved'
  | 'buying_signal'
  | 'insight';

export interface TimelineMoment {
  id: string;
  type: TimelineMomentType;
  label: string;
  title: string;
  timestamp: string;
  seconds: number;
  elapsedLabel: string;
  speakerName?: string;
  excerpt: string;
  insightId?: string;
  turnId?: string;
  abstained?: boolean;
  sentimentPct?: number;
  sentimentDelta?: number;
}

interface SentimentPoint {
  id: string;
  index: number;
  turnId?: string;
  seconds: number;
  elapsedLabel: string;
  timestamp: string;
  sentimentPct: number;
  rawScore: number;
  delta: number;
  speaker: string;
  speakerName: string;
  isRep: boolean;
  text: string;
  shiftType: 'drop' | 'lift' | null;
}

interface ShiftBand {
  id: string;
  startSec: number;
  endSec: number;
  delta: number;
  type: 'drop' | 'lift';
}

interface CallTimelineProps {
  meeting: MeetingSession;
  selectedMomentId: string | null;
  onSelectMoment: (moment: TimelineMoment | null) => void;
  onJumpToTurn: (turnId?: string, excerpt?: string) => void;
  onJumpToInsight: (insightId?: string) => void;
  onStartSimulation?: () => void;
}

type FilterCategory = 'all' | 'shifts' | 'objection' | 'competitor' | 'objection_resolved' | 'buying_signal';

interface HoverTooltipState {
  x: number;
  y: number;
  kind: 'moment' | 'point';
  title: string;
  subtitle: string;
  timestamp: string;
  elapsedLabel: string;
  speakerName?: string;
  sentimentPct?: number;
  sentimentDelta?: number;
  excerpt: string;
  accentColor: string;
}

function parseTimeToSeconds(raw: string | undefined, anchorTurnsSec?: number[]): number | null {
  if (!raw) return null;
  const hmsMatch = raw.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hmsMatch) {
    const h = Number(hmsMatch[1]);
    const m = Number(hmsMatch[2]);
    const s = Number(hmsMatch[3]);
    return h * 3600 + m * 60 + s;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  const utcSec =
    parsed.getUTCHours() * 3600 + parsed.getUTCMinutes() * 60 + parsed.getUTCSeconds();
  const localSec =
    parsed.getHours() * 3600 + parsed.getMinutes() * 60 + parsed.getSeconds();

  if (anchorTurnsSec && anchorTurnsSec.length > 0) {
    const avg = anchorTurnsSec.reduce((a, b) => a + b, 0) / anchorTurnsSec.length;
    return Math.abs(utcSec - avg) <= Math.abs(localSec - avg) ? utcSec : localSec;
  }
  return utcSec;
}

function formatHmsFromSeconds(sec: number): string {
  const normalized = ((Math.round(sec) % 86400) + 86400) % 86400;
  const h = Math.floor(normalized / 3600);
  const m = Math.floor((normalized % 3600) / 60);
  const s = normalized % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function formatElapsed(deltaSec: number): string {
  const safe = Math.max(0, Math.round(deltaSec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function scoreToPct(score: number): number {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(score) ? score : 0));
  return Math.round(((clamped + 1) / 2) * 100);
}

function sentimentLabel(pct: number): string {
  if (pct >= 65) return 'Positive';
  if (pct <= 40) return 'Negative';
  return 'Neutral';
}

function momentVisuals(type: TimelineMomentType): {
  shortLabel: string;
  color: string;
  stroke: string;
  textClass: string;
  icon: React.ComponentType<{ className?: string }>;
} {
  switch (type) {
    case 'sentiment_drop':
      return {
        shortLabel: 'Sentiment Drop',
        color: '#BE123C',
        stroke: '#FFFFFF',
        textClass: 'text-[#BE123C]',
        icon: TrendingDown,
      };
    case 'sentiment_lift':
      return {
        shortLabel: 'Sentiment Recovery',
        color: '#059669',
        stroke: '#FFFFFF',
        textClass: 'text-[#047857]',
        icon: TrendingUp,
      };
    case 'objection':
      return {
        shortLabel: 'Key Objection',
        color: '#E11D48',
        stroke: '#FFFFFF',
        textClass: 'text-[#BE123C]',
        icon: AlertTriangle,
      };
    case 'competitor':
      return {
        shortLabel: 'Competitor Mention',
        color: '#D97706',
        stroke: '#FFFFFF',
        textClass: 'text-[#B45309]',
        icon: ShieldAlert,
      };
    case 'objection_resolved':
      return {
        shortLabel: 'Objection Resolved',
        color: '#10B981',
        stroke: '#FFFFFF',
        textClass: 'text-[#047857]',
        icon: CheckCircle2,
      };
    case 'buying_signal':
      return {
        shortLabel: 'Buying Signal',
        color: '#0284C7',
        stroke: '#FFFFFF',
        textClass: 'text-[#0369A1]',
        icon: TrendingUp,
      };
    case 'insight':
    default:
      return {
        shortLabel: 'AI Insight',
        color: '#4F46E5',
        stroke: '#FFFFFF',
        textClass: 'text-[#4338CA]',
        icon: Sparkles,
      };
  }
}

function findMatchingTurnId(
  meeting: MeetingSession,
  excerpt: string,
  timestamp: string,
): string | undefined {
  const byTime = meeting.transcript.find((t) => t.timestamp === timestamp);
  if (byTime) return byTime.id;
  const snippet = excerpt.slice(0, 40).toLowerCase();
  if (!snippet) return undefined;
  return meeting.transcript.find((t) => t.text.toLowerCase().includes(snippet))?.id;
}

function interpolateSentimentAt(points: SentimentPoint[], targetSec: number): number {
  if (points.length === 0) return 50;
  if (points.length === 1 || targetSec <= points[0].seconds) return points[0].sentimentPct;
  const last = points[points.length - 1];
  if (targetSec >= last.seconds) return last.sentimentPct;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (targetSec <= curr.seconds) {
      const span = Math.max(1, curr.seconds - prev.seconds);
      const t = (targetSec - prev.seconds) / span;
      return Math.round(prev.sentimentPct + (curr.sentimentPct - prev.sentimentPct) * t);
    }
  }
  return last.sentimentPct;
}

function deriveTimelineData(meeting: MeetingSession): {
  sentimentPoints: SentimentPoint[];
  shiftBands: ShiftBand[];
  moments: TimelineMoment[];
  startSec: number;
  endSec: number;
  avgSentiment: number;
} {
  const parsedTurnTimes = meeting.transcript
    .map((t) => parseTimeToSeconds(t.timestamp))
    .filter((v): v is number => v !== null);

  const startedParsed = parseTimeToSeconds(meeting.startedAt, parsedTurnTimes);
  const baseStart =
    parsedTurnTimes.length > 0
      ? Math.min(
          ...parsedTurnTimes,
          startedParsed !== null && Math.abs(parsedTurnTimes[0] - startedParsed) <= 1800
            ? startedParsed
            : parsedTurnTimes[0],
        )
      : startedParsed ?? 0;

  // Build monotonically increasing sentiment points from transcript turns
  const sentimentPoints: SentimentPoint[] = [];
  const shiftBands: ShiftBand[] = [];
  const rawMoments: Omit<TimelineMoment, 'elapsedLabel'>[] = [];
  const turnSecondMap = new Map<string, number>();

  let lastSec = baseStart - 1;
  meeting.transcript.forEach((turn, idx) => {
    const parsed = parseTimeToSeconds(turn.timestamp, parsedTurnTimes);
    let sec = parsed !== null ? parsed : baseStart + idx * 25;
    if (sec <= lastSec) {
      sec = lastSec + 4;
    }
    lastSec = sec;
    turnSecondMap.set(turn.id, sec);

    const sentimentPct = scoreToPct(turn.sentimentScore);
    const prev = sentimentPoints[sentimentPoints.length - 1];
    const delta = prev ? sentimentPct - prev.sentimentPct : 0;

    let shiftType: 'drop' | 'lift' | null = null;
    if (prev) {
      if (delta <= -18 || (sentimentPct <= 40 && delta <= -10)) {
        shiftType = 'drop';
      } else if (delta >= 18 || (prev.sentimentPct <= 45 && sentimentPct >= 60 && delta >= 12)) {
        shiftType = 'lift';
      }
    }

    const isRep = turn.speaker === 'Sales Representative' || turn.speaker === 'AE';
    const point: SentimentPoint = {
      id: `pt-${turn.id}`,
      index: idx,
      turnId: turn.id,
      seconds: sec,
      elapsedLabel: formatElapsed(sec - baseStart),
      timestamp: turn.timestamp || formatHmsFromSeconds(sec),
      sentimentPct,
      rawScore: turn.sentimentScore,
      delta,
      speaker: turn.speaker,
      speakerName: turn.speakerName,
      isRep,
      text: turn.text,
      shiftType,
    };
    sentimentPoints.push(point);

    if (prev && shiftType) {
      shiftBands.push({
        id: `band-${turn.id}`,
        startSec: prev.seconds,
        endSec: sec,
        delta,
        type: shiftType,
      });

      rawMoments.push({
        id: `mom-shift-${turn.id}`,
        type: shiftType === 'drop' ? 'sentiment_drop' : 'sentiment_lift',
        label: shiftType === 'drop' ? 'Sentiment Drop' : 'Sentiment Recovery',
        title:
          shiftType === 'drop'
            ? `Sentiment shifted ${delta} pts (${prev.sentimentPct} → ${sentimentPct})`
            : `Sentiment recovered +${delta} pts (${prev.sentimentPct} → ${sentimentPct})`,
        timestamp: point.timestamp,
        seconds: sec,
        speakerName: turn.speakerName,
        excerpt: turn.text,
        turnId: turn.id,
        sentimentPct,
        sentimentDelta: delta,
      });
    }
  });

  // Extract objections, competitors, resolutions, and buying signals from active insights
  const activeInsights = meeting.insights.filter((i) => !i.dismissed);

  for (const ins of activeInsights) {
    const matchedTurnId = findMatchingTurnId(
      meeting,
      ins.trigger.transcriptExcerpt,
      ins.trigger.timestamp,
    );

    const triggerSec =
      (matchedTurnId ? turnSecondMap.get(matchedTurnId) : undefined) ??
      parseTimeToSeconds(ins.trigger.timestamp, parsedTurnTimes) ??
      parseTimeToSeconds(ins.createdAt, parsedTurnTimes) ??
      baseStart;

    const sentimentAtTrigger = interpolateSentimentAt(sentimentPoints, triggerSec);

    if (ins.category === 'competitor' || ins.competitorName) {
      rawMoments.push({
        id: `mom-comp-${ins.id}`,
        type: 'competitor',
        label: 'Competitor Mention',
        title: ins.competitorName
          ? `Competitor Mentioned: ${ins.competitorName}`
          : ins.title,
        timestamp: ins.trigger.timestamp || formatHmsFromSeconds(triggerSec),
        seconds: triggerSec,
        speakerName: ins.trigger.speakerName,
        excerpt: ins.trigger.transcriptExcerpt,
        insightId: ins.id,
        turnId: matchedTurnId,
        sentimentPct: sentimentAtTrigger,
      });
    }

    if (ins.category === 'objection' || ins.category === 'risk' || ins.objectionCategory) {
      if (ins.objectionCategory !== 'Competition / alternative' || ins.category !== 'competitor') {
        rawMoments.push({
          id: `mom-obj-${ins.id}`,
          type: 'objection',
          label: ins.objectionCategory || 'Key Objection',
          title: ins.title,
          timestamp: ins.trigger.timestamp || formatHmsFromSeconds(triggerSec),
          seconds: triggerSec,
          speakerName: ins.trigger.speakerName,
          excerpt: ins.trigger.transcriptExcerpt,
          insightId: ins.id,
          turnId: matchedTurnId,
          sentimentPct: sentimentAtTrigger,
        });
      }
    }

    if (ins.category === 'buying_signal') {
      rawMoments.push({
        id: `mom-buy-${ins.id}`,
        type: 'buying_signal',
        label: 'Buying Signal',
        title: ins.title,
        timestamp: ins.trigger.timestamp || formatHmsFromSeconds(triggerSec),
        seconds: triggerSec,
        speakerName: ins.trigger.speakerName,
        excerpt: ins.trigger.transcriptExcerpt,
        insightId: ins.id,
        turnId: matchedTurnId,
        sentimentPct: sentimentAtTrigger,
      });
    }

    const isResolved =
      ins.objectionStatus === 'resolved' || ins.feedback?.rating === 'already_handled';
    if (isResolved) {
      const resolvedSec = Math.max(
        triggerSec + 8,
        parseTimeToSeconds(ins.updatedAt || ins.feedback?.createdAt, parsedTurnTimes) ??
          triggerSec + 20,
      );
      rawMoments.push({
        id: `mom-res-${ins.id}`,
        type: 'objection_resolved',
        label: 'Objection Resolved',
        title: `Resolved: ${ins.title}`,
        timestamp: formatHmsFromSeconds(resolvedSec),
        seconds: resolvedSec,
        speakerName: ins.feedback?.userName || meeting.aeName,
        excerpt: ins.suggestedResponse || ins.suggestedAction || ins.interpretation,
        insightId: ins.id,
        turnId: matchedTurnId,
        sentimentPct: interpolateSentimentAt(sentimentPoints, resolvedSec),
      });
    }
  }

  // Include non-suppressed deterministic signals that did not produce a linked insight
  for (const sig of meeting.signals) {
    if (sig.suppressedByCooldown) continue;
    const matchedTurnId = findMatchingTurnId(meeting, sig.evidenceExcerpt, sig.createdAt);
    const sigSec =
      (matchedTurnId ? turnSecondMap.get(matchedTurnId) : undefined) ??
      parseTimeToSeconds(sig.createdAt, parsedTurnTimes);
    if (sigSec === null) continue;

    const mappedType: TimelineMomentType =
      sig.signalType === 'competitor'
        ? 'competitor'
        : sig.signalType === 'buying_signal'
        ? 'buying_signal'
        : 'objection';

    const alreadyNear = rawMoments.some(
      (m) => m.type === mappedType && Math.abs(m.seconds - sigSec) <= 8,
    );
    if (!alreadyNear) {
      rawMoments.push({
        id: `mom-sig-${sig.id}`,
        type: mappedType,
        label: sig.category,
        title: sig.entityName ? `${sig.category}: ${sig.entityName}` : sig.category,
        timestamp: sig.createdAt,
        seconds: sigSec,
        excerpt: sig.evidenceExcerpt,
        turnId: matchedTurnId,
        sentimentPct: interpolateSentimentAt(sentimentPoints, sigSec),
      });
    }
  }

  const allSeconds = [
    ...sentimentPoints.map((p) => p.seconds),
    ...rawMoments.map((m) => m.seconds),
  ];

  const startSec = allSeconds.length > 0 ? Math.min(baseStart, ...allSeconds) : baseStart;
  const maxEventSec = allSeconds.length > 0 ? Math.max(...allSeconds) : startSec;
  const rawSpan = maxEventSec - startSec;
  const padSec = rawSpan < 20 ? 30 : Math.max(12, Math.round(rawSpan * 0.08));
  const endSec = Math.max(startSec + 30, maxEventSec + padSec);

  const moments: TimelineMoment[] = rawMoments
    .sort((a, b) => a.seconds - b.seconds)
    .map((m) => ({
      ...m,
      elapsedLabel: formatElapsed(m.seconds - startSec),
    }));

  const avgSentiment =
    sentimentPoints.length > 0
      ? Math.round(
          sentimentPoints.reduce((sum, p) => sum + p.sentimentPct, 0) / sentimentPoints.length,
        )
      : meeting.sentimentTrend.length > 0
      ? Math.round(
          meeting.sentimentTrend.reduce((sum, v) => sum + v, 0) / meeting.sentimentTrend.length,
        )
      : 50;

  return {
    sentimentPoints,
    shiftBands,
    moments,
    startSec,
    endSec,
    avgSentiment,
  };
}

export const CallTimeline: React.FC<CallTimelineProps> = ({
  meeting,
  selectedMomentId,
  onSelectMoment,
  onJumpToTurn,
  onJumpToInsight,
  onStartSimulation,
}) => {
  const [filter, setFilter] = React.useState<FilterCategory>('all');
  const [collapsed, setCollapsed] = React.useState(false);
  const [chartWidth, setChartWidth] = React.useState(860);
  const [tooltip, setTooltip] = React.useState<HoverTooltipState | null>(null);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);

  const { sentimentPoints, shiftBands, moments, startSec, endSec, avgSentiment } = React.useMemo(
    () => deriveTimelineData(meeting),
    [meeting],
  );

  const filteredMoments = React.useMemo(() => {
    if (filter === 'all') return moments;
    if (filter === 'shifts') {
      return moments.filter((m) => m.type === 'sentiment_drop' || m.type === 'sentiment_lift');
    }
    return moments.filter((m) => m.type === filter);
  }, [moments, filter]);

  const counts = React.useMemo(() => {
    let shifts = 0;
    let objection = 0;
    let competitor = 0;
    let objection_resolved = 0;
    let buying_signal = 0;
    for (const m of moments) {
      if (m.type === 'sentiment_drop' || m.type === 'sentiment_lift') shifts += 1;
      else if (m.type === 'objection') objection += 1;
      else if (m.type === 'competitor') competitor += 1;
      else if (m.type === 'objection_resolved') objection_resolved += 1;
      else if (m.type === 'buying_signal') buying_signal += 1;
    }
    return { shifts, objection, competitor, objection_resolved, buying_signal };
  }, [moments]);

  const selectedMoment = React.useMemo(
    () => moments.find((m) => m.id === selectedMomentId) || null,
    [moments, selectedMomentId],
  );

  // Measure chart container responsively
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 120) {
        setChartWidth(Math.floor(rect.width));
      }
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed]);

  // Render D3 timeline visualization
  React.useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || collapsed || sentimentPoints.length === 0) return;

    const width = Math.max(320, chartWidth);
    const height = 186;
    const margin = { top: 24, right: 20, bottom: 26, left: 42 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height);

    const xScale = d3
      .scaleLinear()
      .domain([startSec, endSec])
      .range([margin.left, width - margin.right]);

    const yScale = d3
      .scaleLinear()
      .domain([0, 100])
      .range([height - margin.bottom, margin.top]);

    const neutralY = yScale(50);
    const uid = meeting.id.replace(/[^a-zA-Z0-9_-]/g, '');

    // SVG Definitions: Polarity Stroke Gradient & Split Positive/Negative Area Clips
    const defs = svg.append('defs');

    const strokeGrad = defs
      .append('linearGradient')
      .attr('id', `sent-stroke-${uid}`)
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', 0)
      .attr('y1', yScale(100))
      .attr('x2', 0)
      .attr('y2', yScale(0));

    strokeGrad.append('stop').attr('offset', '0%').attr('stop-color', '#059669');
    strokeGrad.append('stop').attr('offset', '46%').attr('stop-color', '#10B981');
    strokeGrad.append('stop').attr('offset', '52%').attr('stop-color', '#64748B');
    strokeGrad.append('stop').attr('offset', '62%').attr('stop-color', '#F43F5E');
    strokeGrad.append('stop').attr('offset', '100%').attr('stop-color', '#BE123C');

    const posAreaGrad = defs
      .append('linearGradient')
      .attr('id', `sent-pos-fill-${uid}`)
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', 0)
      .attr('y1', margin.top)
      .attr('x2', 0)
      .attr('y2', neutralY);
    posAreaGrad.append('stop').attr('offset', '0%').attr('stop-color', '#10B981').attr('stop-opacity', 0.22);
    posAreaGrad.append('stop').attr('offset', '100%').attr('stop-color', '#10B981').attr('stop-opacity', 0.02);

    const negAreaGrad = defs
      .append('linearGradient')
      .attr('id', `sent-neg-fill-${uid}`)
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', 0)
      .attr('y1', neutralY)
      .attr('x2', 0)
      .attr('y2', height - margin.bottom);
    negAreaGrad.append('stop').attr('offset', '0%').attr('stop-color', '#E11D48').attr('stop-opacity', 0.03);
    negAreaGrad.append('stop').attr('offset', '100%').attr('stop-color', '#E11D48').attr('stop-opacity', 0.22);

    defs
      .append('clipPath')
      .attr('id', `clip-pos-${uid}`)
      .append('rect')
      .attr('x', margin.left)
      .attr('y', margin.top)
      .attr('width', innerWidth)
      .attr('height', Math.max(0, neutralY - margin.top));

    defs
      .append('clipPath')
      .attr('id', `clip-neg-${uid}`)
      .append('rect')
      .attr('x', margin.left)
      .attr('y', neutralY)
      .attr('width', innerWidth)
      .attr('height', Math.max(0, height - margin.bottom - neutralY));

    // 1. Sentiment Shift Highlight Bands (visible in All & Shifts filters)
    if (filter === 'all' || filter === 'shifts') {
      const bandsGroup = svg.append('g').attr('class', 'shift-bands');
      for (const band of shiftBands) {
        const bx1 = xScale(band.startSec);
        const bx2 = xScale(band.endSec);
        const bw = Math.max(8, bx2 - bx1);
        const isDrop = band.type === 'drop';

        bandsGroup
          .append('rect')
          .attr('x', bx1)
          .attr('y', margin.top)
          .attr('width', bw)
          .attr('height', innerHeight)
          .attr('rx', 3)
          .attr('fill', isDrop ? '#FFE4E6' : '#D1FAE5')
          .attr('fill-opacity', 0.45);

        bandsGroup
          .append('text')
          .attr('x', bx1 + bw / 2)
          .attr('y', margin.top - 7)
          .attr('text-anchor', 'middle')
          .attr('fill', isDrop ? '#BE123C' : '#047857')
          .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
          .attr('font-size', '10px')
          .attr('font-weight', '600')
          .text(isDrop ? `${band.delta} pts` : `+${band.delta} pts`);
      }
    }

    // 2. Horizontal Grid Lines & Neutral Baseline
    const gridGroup = svg.append('g').attr('class', 'grid-lines');
    for (const val of [25, 50, 75]) {
      gridGroup
        .append('line')
        .attr('x1', margin.left)
        .attr('x2', width - margin.right)
        .attr('y1', yScale(val))
        .attr('y2', yScale(val))
        .attr('stroke', val === 50 ? '#CBD5E1' : '#E2E8F0')
        .attr('stroke-width', val === 50 ? 1.25 : 1)
        .attr('stroke-dasharray', val === 50 ? '4,3' : '2,4');
    }

    // 3. Axes (D3 Axis Generators)
    const tickCount = Math.max(3, Math.min(7, Math.floor(innerWidth / 110)));
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(tickCount)
      .tickSize(4)
      .tickPadding(6)
      .tickFormat((d) => formatElapsed(Number(d) - startSec));

    const xAxisG = svg
      .append('g')
      .attr('transform', `translate(0, ${height - margin.bottom})`)
      .call(xAxis);

    xAxisG.select('.domain').attr('stroke', '#CBD5E1');
    xAxisG.selectAll('.tick line').attr('stroke', '#CBD5E1');
    xAxisG
      .selectAll('.tick text')
      .attr('fill', '#64748B')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('font-size', '10px');

    const yAxis = d3
      .axisLeft(yScale)
      .tickValues([0, 50, 100])
      .tickSize(0)
      .tickPadding(8)
      .tickFormat((d) => {
        const n = Number(d);
        if (n === 100) return 'Pos';
        if (n === 50) return '50';
        return 'Neg';
      });

    const yAxisG = svg.append('g').attr('transform', `translate(${margin.left}, 0)`).call(yAxis);
    yAxisG.select('.domain').remove();
    yAxisG
      .selectAll('.tick text')
      .attr('fill', (d) => (Number(d) === 100 ? '#047857' : Number(d) === 0 ? '#BE123C' : '#64748B'))
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('font-size', '10px')
      .attr('font-weight', (d) => (Number(d) === 50 ? '500' : '600'));

    // 4. Sentiment Area & Curve (D3 Line & Area with Monotone Interpolation)
    if (sentimentPoints.length >= 2) {
      const areaGen = d3
        .area<SentimentPoint>()
        .x((d) => xScale(d.seconds))
        .y0(neutralY)
        .y1((d) => yScale(d.sentimentPct))
        .curve(d3.curveMonotoneX);

      const lineGen = d3
        .line<SentimentPoint>()
        .x((d) => xScale(d.seconds))
        .y((d) => yScale(d.sentimentPct))
        .curve(d3.curveMonotoneX);

      svg
        .append('path')
        .datum(sentimentPoints)
        .attr('d', areaGen)
        .attr('fill', `url(#sent-pos-fill-${uid})`)
        .attr('clip-path', `url(#clip-pos-${uid})`);

      svg
        .append('path')
        .datum(sentimentPoints)
        .attr('d', areaGen)
        .attr('fill', `url(#sent-neg-fill-${uid})`)
        .attr('clip-path', `url(#clip-neg-${uid})`);

      svg
        .append('path')
        .datum(sentimentPoints)
        .attr('d', lineGen)
        .attr('fill', 'none')
        .attr('stroke', `url(#sent-stroke-${uid})`)
        .attr('stroke-width', 2.25)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');
    }

    // 5. Hover Crosshair Layer (rendered behind interactive markers)
    const crosshairG = svg.append('g').style('display', 'none').style('pointer-events', 'none');
    const crosshairLine = crosshairG
      .append('line')
      .attr('y1', margin.top)
      .attr('y2', height - margin.bottom)
      .attr('stroke', '#4F46E5')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3');
    const crosshairDot = crosshairG
      .append('circle')
      .attr('r', 5)
      .attr('fill', '#4F46E5')
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 2);

    // Interactive transparent background overlay for smooth bisector scrubbing
    const bisect = d3.bisector<SentimentPoint, number>((d) => d.seconds).center;

    svg
      .append('rect')
      .attr('x', margin.left)
      .attr('y', margin.top)
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        const targetSec = xScale.invert(mx);
        const idx = bisect(sentimentPoints, targetSec);
        const pt = sentimentPoints[Math.max(0, Math.min(sentimentPoints.length - 1, idx))];
        if (!pt) return;

        const cx = xScale(pt.seconds);
        const cy = yScale(pt.sentimentPct);
        crosshairG.style('display', null);
        crosshairLine.attr('x1', cx).attr('x2', cx);
        crosshairDot.attr('cx', cx).attr('cy', cy);

        const shiftSuffix =
          pt.shiftType === 'drop'
            ? ` · Shift ${pt.delta} pts`
            : pt.shiftType === 'lift'
            ? ` · Shift +${pt.delta} pts`
            : '';

        setTooltip({
          x: cx,
          y: cy,
          kind: 'point',
          title: `${pt.isRep ? 'Sales Rep' : 'Prospect'} Turn · ${sentimentLabel(pt.sentimentPct)} (${pt.sentimentPct}/100)${shiftSuffix}`,
          subtitle: pt.speakerName,
          timestamp: pt.timestamp,
          elapsedLabel: pt.elapsedLabel,
          speakerName: pt.speakerName,
          sentimentPct: pt.sentimentPct,
          sentimentDelta: pt.shiftType ? pt.delta : undefined,
          excerpt: pt.text,
          accentColor:
            pt.sentimentPct >= 65 ? '#059669' : pt.sentimentPct <= 40 ? '#BE123C' : '#4F46E5',
        });
      })
      .on('mouseleave', () => {
        crosshairG.style('display', 'none');
        setTooltip(null);
      })
      .on('click', (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        const targetSec = xScale.invert(mx);
        const idx = bisect(sentimentPoints, targetSec);
        const pt = sentimentPoints[Math.max(0, Math.min(sentimentPoints.length - 1, idx))];
        if (pt?.turnId) {
          onJumpToTurn(pt.turnId, pt.text);
        }
      });

    // 6. Transcript Turn Points along the Curve
    const pointsG = svg.append('g').attr('class', 'turn-points');
    pointsG
      .selectAll('circle')
      .data(sentimentPoints)
      .join('circle')
      .attr('cx', (d) => xScale(d.seconds))
      .attr('cy', (d) => yScale(d.sentimentPct))
      .attr('r', (d) => (d.isRep ? 3 : 4))
      .attr('fill', (d) =>
        d.sentimentPct >= 65 ? '#10B981' : d.sentimentPct <= 40 ? '#E11D48' : '#64748B',
      )
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mouseenter', (_event, pt) => {
        const cx = xScale(pt.seconds);
        const cy = yScale(pt.sentimentPct);
        crosshairG.style('display', null);
        crosshairLine.attr('x1', cx).attr('x2', cx);
        crosshairDot.attr('cx', cx).attr('cy', cy);

        setTooltip({
          x: cx,
          y: cy,
          kind: 'point',
          title: `${pt.isRep ? 'Sales Rep' : 'Prospect'} · ${sentimentLabel(pt.sentimentPct)} (${pt.sentimentPct}/100)`,
          subtitle: pt.speakerName,
          timestamp: pt.timestamp,
          elapsedLabel: pt.elapsedLabel,
          speakerName: pt.speakerName,
          sentimentPct: pt.sentimentPct,
          sentimentDelta: pt.shiftType ? pt.delta : undefined,
          excerpt: pt.text,
          accentColor:
            pt.sentimentPct >= 65 ? '#059669' : pt.sentimentPct <= 40 ? '#BE123C' : '#4F46E5',
        });
      })
      .on('mouseleave', () => {
        crosshairG.style('display', 'none');
        setTooltip(null);
      })
      .on('click', (event, pt) => {
        event.stopPropagation();
        if (pt.turnId) onJumpToTurn(pt.turnId, pt.text);
      });

    // 7. Key Event & Objection Markers (D3 Symbols with Collision Avoidance)
    const placedCoords: { x: number; y: number }[] = [];
    const markerItems = filteredMoments.map((m) => {
      const x = xScale(m.seconds);
      const basePct = m.sentimentPct ?? interpolateSentimentAt(sentimentPoints, m.seconds);
      let y = yScale(basePct);

      // Keep markers vertically separated when multiple events occur on the same turn
      let attempt = 0;
      while (
        attempt < 6 &&
        placedCoords.some((p) => Math.abs(p.x - x) < 18 && Math.abs(p.y - y) < 18)
      ) {
        attempt += 1;
        const step = Math.ceil(attempt / 2) * 18;
        const candidate = attempt % 2 === 1 ? y - step : y + step;
        if (candidate >= margin.top + 8 && candidate <= height - margin.bottom - 10) {
          y = candidate;
        }
      }
      y = Math.max(margin.top + 8, Math.min(height - margin.bottom - 10, y));
      placedCoords.push({ x, y });
      return { moment: m, x, y };
    });

    const markersG = svg.append('g').attr('class', 'event-markers');

    for (const item of markerItems) {
      const { moment, x, y } = item;
      const vis = momentVisuals(moment.type);
      const isSelected = selectedMomentId === moment.id;

      // Vertical drop-stem from marker to time axis
      markersG
        .append('line')
        .attr('x1', x)
        .attr('x2', x)
        .attr('y1', y + 6)
        .attr('y2', height - margin.bottom)
        .attr('stroke', vis.color)
        .attr('stroke-opacity', isSelected ? 0.85 : 0.35)
        .attr('stroke-width', isSelected ? 1.5 : 1)
        .attr('stroke-dasharray', isSelected ? 'none' : '2,2')
        .style('pointer-events', 'none');

      // Axis anchor tick
      markersG
        .append('circle')
        .attr('cx', x)
        .attr('cy', height - margin.bottom)
        .attr('r', isSelected ? 3 : 2)
        .attr('fill', vis.color)
        .style('pointer-events', 'none');

      const nodeG = markersG
        .append('g')
        .attr('transform', `translate(${x}, ${y})`)
        .style('cursor', 'pointer')
        .attr('role', 'button')
        .attr('tabindex', 0)
        .attr('aria-label', `${moment.label}: ${moment.title} at ${moment.timestamp}`);

      if (isSelected) {
        nodeG
          .append('circle')
          .attr('r', 11)
          .attr('fill', vis.color)
          .attr('fill-opacity', 0.16)
          .attr('stroke', vis.color)
          .attr('stroke-width', 1.5);
      }

      // Distinct geometric symbol per event category (never hue-only)
      let symbolPath: string | null = null;
      let rotation = 0;
      const symSize = isSelected ? 115 : 82;

      if (moment.type === 'objection') {
        symbolPath = d3.symbol().type(d3.symbolDiamond).size(symSize)();
      } else if (moment.type === 'sentiment_drop') {
        symbolPath = d3.symbol().type(d3.symbolTriangle).size(symSize)();
        rotation = 180;
      } else if (moment.type === 'sentiment_lift') {
        symbolPath = d3.symbol().type(d3.symbolTriangle).size(symSize)();
      } else if (moment.type === 'competitor') {
        symbolPath = d3.symbol().type(d3.symbolSquare).size(symSize - 10)();
      } else if (moment.type === 'buying_signal') {
        symbolPath = d3.symbol().type(d3.symbolStar).size(symSize + 10)();
      } else {
        symbolPath = d3.symbol().type(d3.symbolCircle).size(symSize)();
      }

      if (symbolPath) {
        nodeG
          .append('path')
          .attr('d', symbolPath)
          .attr('transform', rotation ? `rotate(${rotation})` : null)
          .attr('fill', vis.color)
          .attr('stroke', vis.stroke)
          .attr('stroke-width', 1.75);
      }

      // Hit target for comfortable clicking
      nodeG.append('circle').attr('r', 12).attr('fill', 'transparent');

      nodeG
        .on('mouseenter', () => {
          crosshairG.style('display', null);
          crosshairLine.attr('x1', x).attr('x2', x);
          crosshairDot.attr('cx', x).attr('cy', y);

          setTooltip({
            x,
            y,
            kind: 'moment',
            title: moment.title,
            subtitle: moment.label,
            timestamp: moment.timestamp,
            elapsedLabel: moment.elapsedLabel,
            speakerName: moment.speakerName,
            sentimentPct: moment.sentimentPct,
            sentimentDelta: moment.sentimentDelta,
            excerpt: moment.excerpt,
            accentColor: vis.color,
          });
        })
        .on('mouseleave', () => {
          crosshairG.style('display', 'none');
          setTooltip(null);
        })
        .on('click', (event: MouseEvent) => {
          event.stopPropagation();
          onSelectMoment(isSelected ? null : moment);
        })
        .on('keydown', (event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelectMoment(isSelected ? null : moment);
          }
        });
    }
  }, [
    chartWidth,
    collapsed,
    endSec,
    filter,
    filteredMoments,
    meeting.id,
    onJumpToTurn,
    onSelectMoment,
    selectedMomentId,
    sentimentPoints,
    shiftBands,
    startSec,
  ]);

  // Compute safe tooltip horizontal positioning so it never clips outside the chart card
  const tooltipLeftPct = tooltip ? (tooltip.x / Math.max(320, chartWidth)) * 100 : 50;
  const alignRight = tooltipLeftPct > 64;

  return (
    <div className="eki-card rounded-lg overflow-hidden">
      {/* Header & Interactive Filter Controls */}
      <div className="px-4 py-2.5 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-[#4F46E5] shrink-0" />
            <h2 className="font-display text-[13px] font-semibold text-slate-900 whitespace-nowrap">
              Sentiment &amp; Objections Timeline
            </h2>
          </div>

          {sentimentPoints.length > 0 && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
              <span>
                Avg{' '}
                <strong
                  className={
                    avgSentiment >= 65
                      ? 'text-emerald-700'
                      : avgSentiment <= 40
                      ? 'text-[#BE123C]'
                      : 'text-slate-700'
                  }
                >
                  {avgSentiment}/100
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>{counts.shifts} shifts</span>
              <span aria-hidden="true">·</span>
              <span className={counts.objection > 0 ? 'text-[#BE123C] font-semibold' : ''}>
                {counts.objection} objections
              </span>
              <span aria-hidden="true">·</span>
              <span>{counts.competitor} competitor</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-md overflow-x-auto">
            {(
              [
                { id: 'all', label: `All (${moments.length})` },
                { id: 'shifts', label: `Shifts (${counts.shifts})` },
                { id: 'objection', label: `Objections (${counts.objection})` },
                { id: 'competitor', label: `Competitor (${counts.competitor})` },
                { id: 'objection_resolved', label: `Resolved (${counts.objection_resolved})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  filter === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand timeline' : 'Collapse timeline'}
            className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors shrink-0"
          >
            {collapsed ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="bg-[#F8FAFC]/60">
          {sentimentPoints.length === 0 ? (
            <div className="px-5 py-6 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-slate-800">
                  Waiting for conversation telemetry
                </div>
                <p className="text-xs text-slate-500">
                  The D3 sentiment trajectory, sudden sentiment shifts, and key objections will plot live as transcript turns arrive.
                </p>
              </div>
              {onStartSimulation && (
                <button
                  type="button"
                  onClick={onStartSimulation}
                  className="eki-btn-primary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Play className="w-3.5 h-3.5" />
                  Start &amp; Play Simulation
                </button>
              )}
            </div>
          ) : (
            <div className="px-4 pt-2 pb-2.5">
              {/* Responsive D3 SVG Chart Canvas */}
              <div ref={containerRef} className="relative w-full select-none">
                <svg
                  ref={svgRef}
                  className="block w-full overflow-visible"
                  role="img"
                  aria-label="Conversation sentiment trajectory and key objections timeline"
                />

                {/* Interactive Floating Tooltip */}
                {tooltip && (
                  <div
                    style={{
                      left: alignRight ? undefined : `${Math.min(chartWidth - 260, Math.max(44, tooltip.x + 12))}px`,
                      right: alignRight ? `${Math.max(16, chartWidth - tooltip.x + 12)}px` : undefined,
                      top: '8px',
                    }}
                    className="pointer-events-none absolute z-30 w-[264px] rounded-md border border-slate-200 bg-white/95 backdrop-blur-xs shadow-md p-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span
                        className="font-semibold truncate"
                        style={{ color: tooltip.accentColor }}
                      >
                        {tooltip.subtitle}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-slate-500 shrink-0">
                        {tooltip.timestamp} ({tooltip.elapsedLabel})
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-900 leading-snug">
                      {tooltip.title}
                    </div>
                    {tooltip.sentimentPct !== undefined && (
                      <div className="text-[11px] font-mono tabular-nums text-slate-500">
                        Sentiment {tooltip.sentimentPct}/100
                        {tooltip.sentimentDelta !== undefined && (
                          <span
                            className={
                              tooltip.sentimentDelta < 0
                                ? ' text-[#BE123C] font-semibold'
                                : ' text-[#047857] font-semibold'
                            }
                          >
                            {' '}
                            ({tooltip.sentimentDelta > 0 ? `+${tooltip.sentimentDelta}` : tooltip.sentimentDelta}{' '}
                            pts)
                          </span>
                        )}
                      </div>
                    )}
                    <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                      “{tooltip.excerpt}”
                    </p>
                  </div>
                )}
              </div>

              {/* Shape-Encoded Accessible Legend Row */}
              <div className="mt-1.5 pt-2 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-1.5 text-[#BE123C]">
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <polygon points="5,0 10,5 5,10 0,5" fill="#E11D48" />
                    </svg>
                    Key Objection
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[#BE123C]">
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <polygon points="1,2 9,2 5,9" fill="#BE123C" />
                    </svg>
                    Sentiment Drop
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[#047857]">
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <polygon points="5,1 9,8 1,8" fill="#059669" />
                    </svg>
                    Sentiment Recovery
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[#B45309]">
                    <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
                      <rect x="1" y="1" width="7" height="7" fill="#D97706" />
                    </svg>
                    Competitor
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[#047857]">
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <circle cx="5" cy="5" r="4" fill="#10B981" />
                    </svg>
                    Resolved
                  </span>
                </div>
                <span className="text-[11px] text-slate-400">
                  Hover curve to scrub · Click any marker to jump to turn
                </span>
              </div>
            </div>
          )}

          {/* Selected Moment Inspector Strip */}
          {selectedMoment && (
            <div className="px-4 py-3 border-t border-slate-200 bg-white flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`font-semibold ${momentVisuals(selectedMoment.type).textClass}`}>
                    {selectedMoment.label}
                  </span>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-slate-500">
                    {selectedMoment.timestamp} ({selectedMoment.elapsedLabel})
                  </span>
                  {selectedMoment.sentimentPct !== undefined && (
                    <>
                      <span className="text-slate-300" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-600">
                        Sentiment {selectedMoment.sentimentPct}/100
                        {selectedMoment.sentimentDelta !== undefined &&
                          ` (${selectedMoment.sentimentDelta > 0 ? `+${selectedMoment.sentimentDelta}` : selectedMoment.sentimentDelta} pts)`}
                      </span>
                    </>
                  )}
                  {selectedMoment.speakerName && (
                    <>
                      <span className="text-slate-300" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-slate-600 font-medium">
                        {selectedMoment.speakerName}
                      </span>
                    </>
                  )}
                </div>
                <div className="text-[13px] font-semibold text-slate-900">
                  {selectedMoment.title}
                </div>
                <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                  {selectedMoment.excerpt}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {(selectedMoment.turnId || selectedMoment.excerpt) && (
                  <button
                    type="button"
                    onClick={() => onJumpToTurn(selectedMoment.turnId, selectedMoment.excerpt)}
                    className="eki-btn-secondary px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-slate-600" />
                    Jump to Turn
                  </button>
                )}
                {selectedMoment.insightId && (
                  <button
                    type="button"
                    onClick={() => onJumpToInsight(selectedMoment.insightId)}
                    className="eki-btn-primary px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    View Insight
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onSelectMoment(null)}
                  aria-label="Close moment details"
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
