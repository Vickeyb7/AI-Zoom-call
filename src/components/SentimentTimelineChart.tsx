import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, TrendingDown, TrendingUp } from 'lucide-react';
import type { MeetingSession, SentimentTimelineSegment } from '../types/sales';

interface SentimentTimelineChartProps {
  meeting: MeetingSession;
  compact?: boolean;
}

export interface SentimentChartPoint extends SentimentTimelineSegment {
  delta: number | null;
}

export function classifySentimentTone(score: number): SentimentTimelineSegment['tone'] {
  if (score >= 65) return 'Constructive';
  if (score >= 45) return 'Neutral';
  if (score >= 30) return 'Cautious';
  return 'Friction';
}

function classifyTone(score: number): SentimentTimelineSegment['tone'] {
  return classifySentimentTone(score);
}

function toneHex(tone: SentimentTimelineSegment['tone']): string {
  if (tone === 'Constructive') return '#059669';
  if (tone === 'Neutral') return '#4F46E5';
  if (tone === 'Cautious') return '#D97706';
  return '#E11D48';
}

function toneTextClass(tone: SentimentTimelineSegment['tone']): string {
  if (tone === 'Constructive') return 'text-emerald-700';
  if (tone === 'Neutral') return 'text-indigo-700';
  if (tone === 'Cautious') return 'text-amber-700';
  return 'text-rose-700';
}

const DEFAULT_PHASE_LABELS: Record<number, string[]> = {
  2: ['Opening', 'Closing'],
  3: ['Opening', 'Discussion', 'Closing'],
  4: ['Opening', 'Discovery', 'Objections', 'Closing'],
  5: ['Opening', 'Discovery', 'Evaluation', 'Objections', 'Closing'],
  6: ['Opening', 'Discovery', 'Evaluation', 'Objections', 'Alignment', 'Closing'],
};

function phaseNameForIndex(idx: number, total: number): string {
  const preset = DEFAULT_PHASE_LABELS[total];
  if (preset && preset[idx]) return preset[idx];
  if (idx === 0) return 'Opening';
  if (idx === total - 1) return 'Closing';
  return `Segment ${idx + 1}`;
}

export function deriveSentimentSegments(meeting: MeetingSession): SentimentChartPoint[] {
  let base: SentimentTimelineSegment[] = [];

  // 1. Prefer persisted privacy-safe snapshot segments (retained after raw transcript purge)
  if (meeting.sentimentSegments && meeting.sentimentSegments.length > 0) {
    base = meeting.sentimentSegments;
  } else if (meeting.transcript && meeting.transcript.length > 0) {
    // 2. Derive live chronological segments directly from active transcript turns
    const turns = meeting.transcript;
    const segmentCount = Math.min(6, Math.max(1, turns.length <= 4 ? turns.length : Math.ceil(turns.length / 2)));

    for (let i = 0; i < segmentCount; i++) {
      const startIdx = Math.floor((i * turns.length) / segmentCount);
      const endIdx = Math.max(startIdx + 1, Math.floor(((i + 1) * turns.length) / segmentCount));
      const slice = turns.slice(startIdx, endIdx);
      if (slice.length === 0) continue;

      const avgRaw =
        slice.reduce((acc, t) => acc + (typeof t.sentimentScore === 'number' ? t.sentimentScore : 0), 0) /
        slice.length;
      const score = Math.max(5, Math.min(98, Math.round(((avgRaw + 1) / 2) * 100)));
      const tags = slice.flatMap((t) => t.detectedTags || []).filter(Boolean);
      const topic = tags[0];
      const firstTs = slice[0]?.timestamp;
      const lastTs = slice[slice.length - 1]?.timestamp;

      const label =
        segmentCount === 1
          ? 'Opening'
          : i === 0
          ? 'Opening'
          : i === segmentCount - 1
          ? 'Closing'
          : topic
          ? topic.length > 18
            ? `${topic.slice(0, 17)}…`
            : topic
          : phaseNameForIndex(i, segmentCount);

      base.push({
        index: base.length + 1,
        label,
        timeRange: firstTs && lastTs && firstTs !== lastTs ? `${firstTs} – ${lastTs}` : firstTs,
        score,
        tone: classifyTone(score),
        turnCount: slice.length,
        topic,
      });
    }
  } else if (meeting.sentimentTrend && meeting.sentimentTrend.length > 0) {
    // 3. Fallback to stored meeting sentimentTrend series + signal annotations
    const trend = meeting.sentimentTrend;
    const signals = meeting.signals || [];
    base = trend.map((rawScore, idx) => {
      const score = Math.max(0, Math.min(100, Math.round(rawScore)));
      const matchedSignal =
        signals.length > 0
          ? signals[Math.min(signals.length - 1, Math.floor((idx / Math.max(1, trend.length)) * signals.length))]
          : undefined;
      const showSignalTopic = idx > 0 && matchedSignal && signals.length > 0;
      return {
        index: idx + 1,
        label: phaseNameForIndex(idx, trend.length),
        score,
        tone: classifyTone(score),
        turnCount: 0,
        topic: showSignalTopic
          ? matchedSignal.entityName || matchedSignal.category
          : undefined,
      };
    });
  }

  return base.map((seg, idx) => ({
    ...seg,
    delta: idx === 0 ? null : seg.score - base[idx - 1].score,
  }));
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { payload: SentimentChartPoint }[];
}

const SentimentTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-md text-xs space-y-1 max-w-[230px]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-slate-900">{point.label}</span>
        <span className={`font-mono font-semibold tabular-nums ${toneTextClass(point.tone)}`}>
          {point.score}%
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <span className={`font-medium ${toneTextClass(point.tone)}`}>{point.tone}</span>
        {point.delta !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span
              className={`font-mono tabular-nums ${
                point.delta > 0
                  ? 'text-emerald-700'
                  : point.delta < 0
                  ? 'text-rose-700'
                  : 'text-slate-500'
              }`}
            >
              {point.delta > 0 ? `+${point.delta}` : point.delta} pts
            </span>
          </>
        )}
      </div>
      {point.timeRange && (
        <div className="text-[11px] font-mono tabular-nums text-slate-400">
          {point.timeRange}
          {point.turnCount > 0 ? ` · ${point.turnCount} turn${point.turnCount === 1 ? '' : 's'}` : ''}
        </div>
      )}
      {point.topic && (
        <div className="pt-1 border-t border-slate-100 text-[11px] text-slate-600">
          Topic: <span className="font-medium text-slate-800">{point.topic}</span>
        </div>
      )}
    </div>
  );
};

interface CustomDotProps {
  cx?: number;
  cy?: number;
  payload?: SentimentChartPoint;
}

const SentimentSegmentDot: React.FC<CustomDotProps> = ({ cx, cy, payload }) => {
  if (typeof cx !== 'number' || typeof cy !== 'number' || !payload) return null;
  const fill = toneHex(payload.tone);
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={fill}
      stroke="#FFFFFF"
      strokeWidth={1.75}
    />
  );
};

export const SentimentTimelineChart: React.FC<SentimentTimelineChartProps> = ({
  meeting,
  compact = false,
}) => {
  const gradientId = React.useId().replace(/:/g, '');
  const points = React.useMemo(() => deriveSentimentSegments(meeting), [meeting]);

  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
          <Activity className="w-3.5 h-3.5 text-[#4F46E5]" />
          <span>Sentiment Analysis Timeline</span>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Sentiment flow across meeting segments will appear once conversation turns are recorded.
        </p>
      </div>
    );
  }

  const avgScore = Math.round(points.reduce((sum, p) => sum + p.score, 0) / points.length);
  const overallTone = classifyTone(avgScore);
  const opening = points[0];
  const closing = points[points.length - 1];
  const netShift = closing.score - opening.score;
  const lowestPoint = points.reduce((min, p) => (p.score < min.score ? p : min), points[0]);
  const peakPoint = points.reduce((max, p) => (p.score > max.score ? p : max), points[0]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      {/* Header & Unboxed Summary Metrics */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-0.5">
          <h4 className="font-display text-[13px] font-semibold text-slate-900">
            Sentiment Analysis Timeline
          </h4>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            <span>
              Avg{' '}
              <strong className="font-mono tabular-nums text-slate-800">{avgScore}%</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span className={`font-medium ${toneTextClass(overallTone)}`}>{overallTone}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {points.length} {points.length === 1 ? 'segment' : 'segments'}
            </span>
          </div>
        </div>

        <div
          className={`inline-flex items-center gap-1 text-xs font-mono font-semibold tabular-nums whitespace-nowrap ${
            netShift > 0
              ? 'text-emerald-700'
              : netShift < 0
              ? 'text-rose-700'
              : 'text-slate-600'
          }`}
        >
          {netShift > 0 ? (
            <TrendingUp className="w-3.5 h-3.5" />
          ) : netShift < 0 ? (
            <TrendingDown className="w-3.5 h-3.5" />
          ) : null}
          <span>
            {netShift > 0 ? `+${netShift}` : netShift} pts shift
          </span>
        </div>
      </div>

      {/* Recharts Area Timeline */}
      <div className={compact ? 'h-[190px] w-full' : 'h-[220px] w-full'}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ top: 10, right: 12, left: -18, bottom: 2 }}
          >
            <defs>
              <linearGradient id={`sentimentFill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.01} />
              </linearGradient>
            </defs>

            <CartesianGrid
              stroke="#E2E8F0"
              strokeDasharray="3 3"
              vertical={false}
            />

            <XAxis
              dataKey="label"
              tick={{ fill: '#64748B', fontSize: 11 }}
              axisLine={{ stroke: '#E2E8F0' }}
              tickLine={false}
              interval="preserveStartEnd"
            />

            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fill: '#64748B', fontSize: 10.5 }}
              tickFormatter={(v: number) => `${v}%`}
              axisLine={false}
              tickLine={false}
            />

            <ReferenceLine
              y={50}
              stroke="#94A3B8"
              strokeDasharray="4 4"
              label={{
                value: 'Neutral',
                position: 'insideTopRight',
                fill: '#94A3B8',
                fontSize: 10,
              }}
            />

            <Tooltip
              content={<SentimentTooltip />}
              cursor={{ stroke: '#94A3B8', strokeWidth: 1, strokeDasharray: '3 3' }}
            />

            <Area
              type="monotone"
              dataKey="score"
              stroke="#4F46E5"
              strokeWidth={2}
              fill={`url(#sentimentFill-${gradientId})`}
              dot={<SentimentSegmentDot />}
              activeDot={{ r: 5.5, fill: '#4F46E5', stroke: '#FFFFFF', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Segment Flow Footer */}
      <div className="pt-2.5 border-t border-slate-100 grid grid-cols-3 gap-2 text-[11px]">
        <div className="min-w-0">
          <div className="text-slate-500">Opening</div>
          <div className="font-mono font-semibold tabular-nums text-slate-900 truncate">
            {opening.score}% · {opening.tone}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-slate-500">Lowest / Peak</div>
          <div className="font-mono font-semibold tabular-nums text-slate-900 truncate">
            {lowestPoint.score}% / {peakPoint.score}%
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-slate-500">Closing</div>
          <div className={`font-mono font-semibold tabular-nums truncate ${toneTextClass(closing.tone)}`}>
            {closing.score}% · {closing.tone}
          </div>
        </div>
      </div>
    </div>
  );
};
