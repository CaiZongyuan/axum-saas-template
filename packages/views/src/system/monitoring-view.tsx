import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { errorCodeOf } from '@saas/core';
import { sessionKey } from '../identity';
import {
  getMonitoringSnapshot,
  type ApiClient,
  type CurrentSession,
} from '@saas/sdk';
import { Activity, ExternalLink, RefreshCw } from 'lucide-react';
import { Badge } from '@saas/ui/components/badge';
import { Button } from '@saas/ui/components/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@saas/ui/components/card';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas/ui/components/empty';
import {
  NativeSelect,
  NativeSelectOption,
} from '@saas/ui/components/native-select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@saas/ui/components/tabs';
import { TooltipProvider } from '@saas/ui/components/tooltip';
import { SettingsCard, SettingsRow } from '../shell/settings-kit';
import { useAppMessage } from '../shell/messages';
import { useAppFormat } from '../shell/format';
import { usePreferences } from '../shell/preferences';
import { docsChapterUrl } from '../shell/docs-links';
import { ErrorAlert } from '../shell/error-alert';
import { Metric, MetricLabel } from './monitoring-metrics';
import { MonitoringAlerts } from './monitoring-alerts';

const MonitoringCharts = lazy(() => import('./monitoring-charts'));
const tabs = ['overview', 'requests', 'jobs', 'collection'] as const;

export default function MonitoringView({
  apiClient,
  identity,
  docsUrl,
  onOpen,
  onDirtyChange,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  docsUrl: string;
  onOpen?: (path: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const message = useAppMessage();
  const queryClient = useQueryClient();
  const { formatNumber, formatDateTime } = useAppFormat();
  const { locale } = usePreferences();
  const [windowMinutes, setWindowMinutes] = useState<15 | 60>(15);
  const query = useQuery({
    queryKey: [
      'monitoring',
      apiClient.getConfig().baseUrl,
      identity.user.id,
      windowMinutes,
    ],
    queryFn: async ({ signal }) =>
      (
        await getMonitoringSnapshot({
          client: apiClient,
          query: { window_minutes: windowMinutes },
          signal,
          throwOnError: true,
        })
      ).data,
    retry: false,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (
      [
        'auth.unauthorized',
        'system.forbidden',
        'monitoring.forbidden',
      ].includes(errorCodeOf(query.error) ?? '')
    ) {
      void queryClient.invalidateQueries({ queryKey: sessionKey(apiClient) });
    }
  }, [apiClient, query.error, queryClient]);
  // A failed refresh cannot leave green service badges or old numbers looking current.
  const data = query.isError ? undefined : query.data;
  const http = data?.collection.state === 'collecting' ? data.http : null;
  const value = (number: number | null | undefined, unit = '') =>
    number === null || number === undefined
      ? '—'
      : `${formatNumber(Math.round(number * 100) / 100)}${unit}`;
  const status = (state: string) => (
    <Badge variant="outline">{message(`monitoring.state.${state}`)}</Badge>
  );
  const label = (metric: string) => (
    <MetricLabel
      name={message(`monitoring.metric.${metric}`)}
      help={message(`monitoring.help.${metric}`)}
    />
  );
  const requestMetrics = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric metric="requests" value={value(http?.requests)} />
      <Metric metric="errorRate" value={value(http?.error_rate_percent, '%')} />
      <Metric metric="p50" value={value(http?.p50_ms, ' ms')} />
      <Metric metric="p95" value={value(http?.p95_ms, ' ms')} />
    </div>
  );
  const jobMetrics = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric metric="waiting" value={value(data?.jobs.waiting)} />
      <Metric metric="running" value={value(data?.jobs.running)} />
      <Metric metric="failed" value={value(data?.jobs.failed)} />
      <Metric
        metric="oldestWait"
        value={value(
          data?.jobs.oldest_wait_seconds,
          ` ${message('monitoring.seconds')}`,
        )}
      />
    </div>
  );
  const chart = (metric: 'requests' | 'errorRate' | 'p95') => (
    <Card>
      <CardHeader>
        <CardTitle>
          {label(metric === 'requests' ? 'throughput' : metric)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data &&
        http?.series.some(
          (point) =>
            point[
              metric === 'requests'
                ? 'requests_per_second'
                : metric === 'errorRate'
                  ? 'error_rate_percent'
                  : 'p95_ms'
            ] != null,
        ) ? (
          <Suspense
            fallback={<p role="status">{message('monitoring.chartLoading')}</p>}
          >
            <MonitoringCharts kind={metric} snapshot={data} />
          </Suspense>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Activity aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{message('monitoring.noSamples')}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
  return (
    <TooltipProvider>
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {data ? status(data.collection.state) : null}
            {data ? (
              <span className="text-xs text-muted-foreground">
                {message('monitoring.checkedAt', {
                  at: formatDateTime(data.checked_at),
                })}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label={message('monitoring.window')}
              value={windowMinutes}
              onChange={(event) =>
                setWindowMinutes(Number(event.target.value) as 15 | 60)
              }
            >
              <NativeSelectOption value={15}>
                {message('monitoring.last15')}
              </NativeSelectOption>
              <NativeSelectOption value={60}>
                {message('monitoring.last60')}
              </NativeSelectOption>
            </NativeSelect>
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw data-icon="inline-start" />
              {message('monitoring.refresh')}
            </Button>
          </div>
        </div>
        {query.isPending ? (
          <p role="status">{message('monitoring.loading')}</p>
        ) : null}
        {query.isError ? (
          <ErrorAlert
            error={query.error}
            title={message('monitoring.loadFailed')}
            genericKey="monitoring.retryHint"
          />
        ) : null}
        <Tabs defaultValue="overview" className="gap-5">
          <TabsList variant="line" className="max-w-full flex-wrap h-auto!">
            {tabs.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {message(`monitoring.tab.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="overview" className="flex flex-col gap-5">
            <SettingsCard>
              {(['api', 'database', 'worker'] as const).map((service) => (
                <SettingsRow key={service} label={label(service)}>
                  {data ? status(data.services[service]) : '—'}
                </SettingsRow>
              ))}
            </SettingsCard>
            {requestMetrics}
            {chart('requests')}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {message('monitoring.queueSnapshot')}
              </h2>
              <a
                className="text-sm text-link hover:underline"
                href="/jobs"
                onClick={
                  onOpen
                    ? (event) => {
                        event.preventDefault();
                        onOpen('/jobs');
                      }
                    : undefined
                }
              >
                {message('monitoring.openJobs')}
              </a>
            </div>
            {jobMetrics}
          </TabsContent>
          <TabsContent value="requests" className="flex flex-col gap-5">
            {requestMetrics}
            {chart('requests')}
            <div className="grid gap-4 xl:grid-cols-2">
              {chart('p95')}
              {chart('errorRate')}
            </div>
          </TabsContent>
          <TabsContent value="jobs" className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {message('monitoring.queueSnapshot')}
              </h2>
              <a
                href="/jobs"
                className="text-sm text-link hover:underline"
                onClick={
                  onOpen
                    ? (event) => {
                        event.preventDefault();
                        onOpen('/jobs');
                      }
                    : undefined
                }
              >
                {message('monitoring.openJobs')}
              </a>
            </div>
            {jobMetrics}
            <Card>
              <CardHeader>
                <CardTitle>{label('attempts')}</CardTitle>
              </CardHeader>
              <CardContent>
                {data?.jobs.attempts.length ? (
                  <Suspense
                    fallback={
                      <p role="status">{message('monitoring.chartLoading')}</p>
                    }
                  >
                    <MonitoringCharts kind="jobs" snapshot={data} />
                  </Suspense>
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>
                        {message('monitoring.noAttempts')}
                      </EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent
            value="collection"
            keepMounted
            className="flex flex-col gap-5 [&[hidden]]:hidden"
          >
            <SettingsCard>
              <SettingsRow label={label('collection')}>
                {data ? status(data.collection.state) : '—'}
              </SettingsRow>
              <SettingsRow label={label('lastSample')}>
                {data?.collection.last_sample_at
                  ? formatDateTime(data.collection.last_sample_at)
                  : '—'}
              </SettingsRow>
              <SettingsRow label={label('grafana')}>
                {data?.grafana_url ? (
                  <a
                    href={data.grafana_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-link hover:underline"
                  >
                    {message('monitoring.openGrafana')}
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {message('monitoring.state.unconfigured')}
                  </span>
                )}
              </SettingsRow>
            </SettingsCard>
            <a
              href={docsChapterUrl(
                docsUrl,
                locale,
                'tutorials/observability.md',
              )}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-link hover:underline"
            >
              {message('monitoring.setupGuide')}
            </a>
            <MonitoringAlerts
              apiClient={apiClient}
              identity={identity}
              onDirtyChange={onDirtyChange}
            />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
