import { useMemo } from 'react';
import { defineChart, lineY, barY } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { scaleBand } from '@tanstack/charts/scales/band';
import { tooltip } from '@tanstack/charts/tooltip';
import type { MonitoringSnapshot } from '@saas/sdk';
import { useAppMessage } from '../shell/messages';
import { usePreferences, localeTag } from '../shell/preferences';

const theme = {
  foreground: 'var(--foreground)',
  muted: 'var(--muted-foreground)',
  grid: 'var(--border)',
  background: 'var(--card)',
  palette: ['var(--info)', 'var(--success)', 'var(--warning)'],
};
type Kind = 'requests' | 'errorRate' | 'p95' | 'jobs';

export default function MonitoringCharts({
  kind,
  snapshot,
}: {
  kind: Kind;
  snapshot: MonitoringSnapshot;
}) {
  return kind === 'jobs' ? (
    <AttemptChart snapshot={snapshot} />
  ) : (
    <TimeChart kind={kind} snapshot={snapshot} />
  );
}

function TimeChart({
  kind,
  snapshot,
}: {
  kind: Exclude<Kind, 'jobs'>;
  snapshot: MonitoringSnapshot;
}) {
  const { locale } = usePreferences();
  const message = useAppMessage();
  const field =
    kind === 'requests'
      ? 'requests_per_second'
      : kind === 'errorRate'
        ? 'error_rate_percent'
        : 'p95_ms';
  const unit =
    kind === 'requests'
      ? message('monitoring.perSecond')
      : kind === 'errorRate'
        ? '%'
        : 'ms';
  const title = message(
    `monitoring.metric.${kind === 'requests' ? 'throughput' : kind}`,
  );
  const definition = useMemo(() => {
    const rows = (snapshot.http?.series ?? []).map((point) => ({
      at: Date.parse(point.at),
      value: point[field],
    }));
    const time = new Intl.DateTimeFormat(localeTag(locale), {
      hour: '2-digit',
      minute: '2-digit',
    });
    const number = new Intl.NumberFormat(localeTag(locale), {
      maximumFractionDigits: 2,
    });
    const end = Date.parse(snapshot.checked_at);
    return defineChart({
      // Keep null samples in the series: lineY breaks the line at missing data.
      marks: [
        lineY(rows, {
          x: 'at',
          y: 'value',
          stroke: 'var(--info)',
          strokeWidth: 2,
        }),
      ],
      scales: {
        x: {
          scale: () =>
            scaleLinear().domain([end - snapshot.window_minutes * 60_000, end]),
          axis: {
            ticks: { count: 4, format: (value: number) => time.format(value) },
          },
        },
        y: {
          scale: () =>
            scaleLinear().domain([
              0,
              Math.max(...rows.map((point) => point.value ?? 0), 1) * 1.12,
            ]),
          nice: true,
          grid: true,
          axis: {
            ticks: {
              count: 4,
              format: (value: number) => number.format(value),
            },
          },
        },
      },
      theme,
      tooltip: {
        use: tooltip,
        format: (point) =>
          `${time.format(point.datum.at)} · ${number.format(point.yValue)} ${unit}`,
      },
    });
  }, [snapshot, field, locale, unit]);
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs text-muted-foreground">{unit}</p>
      <Chart definition={definition} height={220} ariaLabel={title} />
    </div>
  );
}

function AttemptChart({ snapshot }: { snapshot: MonitoringSnapshot }) {
  const message = useAppMessage();
  const { locale } = usePreferences();
  const names: Record<string, string> = {
    succeeded: message('monitoring.outcome.succeeded'),
    success: message('monitoring.outcome.succeeded'),
    transient: message('monitoring.outcome.transient'),
    permanent: message('monitoring.outcome.permanent'),
    failed: message('monitoring.outcome.failed'),
    retry_wait: message('monitoring.outcome.transient'),
    lease_expired: message('monitoring.outcome.leaseExpired'),
  };
  const totals = new Map<string, number>();
  for (const attempt of snapshot.jobs.attempts) {
    totals.set(
      attempt.outcome,
      (totals.get(attempt.outcome) ?? 0) + attempt.count,
    );
  }
  const rows = [...totals].map(([outcome, count]) => ({
    name: names[outcome] ?? outcome,
    count,
  }));
  const number = new Intl.NumberFormat(localeTag(locale), {
    maximumFractionDigits: 0,
  });
  const definition = defineChart({
    marks: [barY(rows, { x: 'name', y: 'count', fill: 'var(--info)' })],
    scales: {
      x: { scale: () => scaleBand().padding(0.4) },
      y: {
        scale: () =>
          scaleLinear().domain([
            0,
            Math.max(...rows.map((row) => row.count), 1) * 1.1,
          ]),
        nice: true,
        grid: true,
        axis: {
          ticks: { count: 4, format: (value: number) => number.format(value) },
        },
      },
    },
    theme,
    tooltip: {
      use: tooltip,
      format: (point) =>
        `${point.datum.name} · ${number.format(point.datum.count)}`,
    },
  });
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs text-muted-foreground">
        {message('monitoring.attemptWindow', {
          minutes: snapshot.window_minutes,
        })}
      </p>
      <Chart
        definition={definition}
        height={240}
        ariaLabel={message('monitoring.metric.attempts')}
      />
    </div>
  );
}
