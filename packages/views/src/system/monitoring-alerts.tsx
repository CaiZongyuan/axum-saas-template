import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMonitoringAlertRule,
  updateMonitoringAlertRule,
  testMonitoringAlert,
  type ApiClient,
  type CurrentSession,
  type MonitoringAlertRule,
} from '@saas/sdk';
import { errorCodeOf } from '@saas/core';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';
import { Badge } from '@saas/ui/components/badge';
import { Button } from '@saas/ui/components/button';
import { Field, FieldGroup, FieldLabel } from '@saas/ui/components/field';
import { Input } from '@saas/ui/components/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@saas/ui/components/native-select';
import { Switch } from '@saas/ui/components/switch';
import { useAppMessage } from '../shell/messages';
import { useAppFormat } from '../shell/format';
import { SettingsCard, SettingsRow } from '../shell/settings-kit';
import { ErrorAlert } from '../shell/error-alert';
import { MetricLabel } from './monitoring-metrics';
import { sessionKey } from '../identity';

export function MonitoringAlerts({
  apiClient,
  identity,
  onDirtyChange,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const message = useAppMessage();
  const { formatDateTime } = useAppFormat();
  const queryClient = useQueryClient();
  const queryKey = [
    'monitoring-alert-rule',
    apiClient.getConfig().baseUrl,
    identity.user.id,
  ];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      (
        await getMonitoringAlertRule({
          client: apiClient,
          signal,
          throwOnError: true,
        })
      ).data,
    retry: false,
    refetchInterval: 30_000,
  });
  // Null means the controls follow the last persisted rule. Edits retain their
  // original version even if polling discovers another administrator's save.
  const [draft, setDraft] = useState<{
    version: number;
    enabled: boolean;
    errorRate: string;
    duration: number;
  } | null>(null);
  const current =
    draft ??
    (query.data
      ? {
          version: query.data.version,
          enabled: query.data.enabled,
          errorRate: String(query.data.error_rate_percent),
          duration: query.data.duration_minutes,
        }
      : null);
  const dirty = draft !== null;
  const [saved, setSaved] = useState(false);
  const id = useId();
  const save = useMutation({
    mutationFn: async () => {
      if (!current || !query.data) throw new Error('Missing rule');
      const rate = Number(current.errorRate);
      return (
        await updateMonitoringAlertRule({
          client: apiClient,
          headers: { 'x-csrf-token': identity.csrf_token },
          body: {
            version: current.version,
            enabled: current.enabled,
            error_rate_percent:
              current.enabled ||
              (Number.isFinite(rate) && rate > 0 && rate <= 100)
                ? rate
                : query.data.error_rate_percent,
            duration_minutes: current.duration,
          },
          throwOnError: true,
        })
      ).data;
    },
    retry: false,
    onSuccess: (rule: MonitoringAlertRule) => {
      queryClient.setQueryData(queryKey, rule);
      setDraft(null);
      setSaved(true);
    },
  });
  const test = useMutation({
    mutationFn: async () =>
      (
        await testMonitoringAlert({
          client: apiClient,
          body: {},
          headers: { 'x-csrf-token': identity.csrf_token },
          throwOnError: true,
        })
      ).data,
    retry: false,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [
          'notifications',
          apiClient.getConfig().baseUrl,
          identity.user.id,
        ],
      }),
  });
  const accessDenied = [query.error, save.error, test.error].some((error) =>
    ['auth.unauthorized', 'system.forbidden', 'monitoring.forbidden'].includes(
      errorCodeOf(error) ?? '',
    ),
  );
  useEffect(() => {
    if (accessDenied)
      void queryClient.invalidateQueries({ queryKey: sessionKey(apiClient) });
  }, [accessDenied, apiClient, queryClient]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const change = (patch: Partial<NonNullable<typeof current>>) => {
    if (current) setDraft({ ...current, ...patch });
    setSaved(false);
    save.reset();
  };
  const conflict = errorCodeOf(save.error) === 'monitoring.version_conflict';
  const label = (metric: string) => (
    <MetricLabel
      name={message(`monitoring.metric.${metric}`)}
      help={message(`monitoring.help.${metric}`)}
    />
  );
  if (accessDenied)
    return <p role="alert">{message('monitoring.adminOnly')}</p>;
  return (
    <section
      className="flex flex-col gap-4"
      aria-label={message('monitoring.alertsTitle')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">
          {message('monitoring.alertsTitle')}
        </h2>
        {query.data && !query.isError ? (
          <Badge variant="outline">
            {message(`monitoring.alertState.${query.data.state}`)}
          </Badge>
        ) : null}
        {dirty ? (
          <Badge variant="secondary">{message('monitoring.unsaved')}</Badge>
        ) : null}
      </div>
      {query.isPending ? (
        <p role="status">{message('monitoring.loading')}</p>
      ) : null}
      {query.isError ? (
        <>
          <ErrorAlert
            error={query.error}
            title={message('monitoring.alertLoadFailed')}
            genericKey="monitoring.retryHint"
          />
          <Button variant="outline" onClick={() => void query.refetch()}>
            {message('common.retry')}
          </Button>
        </>
      ) : null}
      {current ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <SettingsCard>
            <SettingsRow label={label('alertsEnabled')}>
              <Switch
                id={`${id}-enabled`}
                aria-label={message('monitoring.metric.alertsEnabled')}
                checked={current.enabled}
                disabled={save.isPending}
                onCheckedChange={(enabled) => change({ enabled })}
              />
            </SettingsRow>
          </SettingsCard>
          <FieldGroup className="sm:flex-row">
            <Field data-disabled={!current.enabled}>
              <div className="flex items-center gap-1">
                <FieldLabel htmlFor={`${id}-rate`}>
                  {message('monitoring.metric.threshold')}
                </FieldLabel>
                <MetricLabel
                  iconOnly
                  name={message('monitoring.metric.threshold')}
                  help={message('monitoring.help.threshold')}
                />
              </div>
              <Input
                id={`${id}-rate`}
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                required
                disabled={!current.enabled || save.isPending}
                value={current.errorRate}
                onChange={(event) => change({ errorRate: event.target.value })}
              />
            </Field>
            <Field data-disabled={!current.enabled}>
              <div className="flex items-center gap-1">
                <FieldLabel htmlFor={`${id}-duration`}>
                  {message('monitoring.metric.duration')}
                </FieldLabel>
                <MetricLabel
                  iconOnly
                  name={message('monitoring.metric.duration')}
                  help={message('monitoring.help.duration')}
                />
              </div>
              <NativeSelect
                id={`${id}-duration`}
                disabled={!current.enabled || save.isPending}
                value={current.duration}
                onChange={(event) =>
                  change({ duration: Number(event.target.value) })
                }
              >
                {[1, 5, 10].map((minutes) => (
                  <NativeSelectOption key={minutes} value={minutes}>
                    {message('monitoring.minutes', { count: minutes })}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          <SettingsCard>
            <SettingsRow label={label('channel')}>
              <span className="text-sm">{message('monitoring.inApp')}</span>
            </SettingsRow>
            <SettingsRow label={label('evaluatedAt')}>
              <span className="text-sm">
                {query.data?.last_evaluated_at
                  ? formatDateTime(query.data.last_evaluated_at)
                  : '—'}
              </span>
            </SettingsRow>
          </SettingsCard>
          {save.isError ? (
            <ErrorAlert
              error={save.error}
              title={message(
                conflict ? 'monitoring.conflict' : 'monitoring.saveFailed',
              )}
              genericKey={
                conflict
                  ? 'monitoring.conflictHint'
                  : 'monitoring.draftRetained'
              }
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!dirty || save.isPending}>
              {message(
                save.isPending ? 'monitoring.saving' : 'monitoring.save',
              )}
            </Button>
            {dirty ? (
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={() => {
                  setDraft(null);
                  save.reset();
                  setSaved(false);
                }}
              >
                {message('monitoring.discard')}
              </Button>
            ) : null}
            {conflict ? (
              <Button
                type="button"
                variant="outline"
                disabled={query.isFetching}
                onClick={async () => {
                  const latest = await query.refetch();
                  if (latest.isSuccess) {
                    setDraft(null);
                    save.reset();
                  }
                }}
              >
                {message('monitoring.loadLatest')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
              {message('monitoring.testAlert')}
            </Button>
          </div>
          {saved ? <p role="status">{message('monitoring.saved')}</p> : null}
          {test.isError ? (
            <ErrorAlert
              error={test.error}
              title={message('monitoring.testFailed')}
              genericKey="monitoring.retryHint"
            />
          ) : null}
          {test.isSuccess ? (
            <Alert role="status">
              <AlertTitle>{message('monitoring.testCreated')}</AlertTitle>
              <AlertDescription>
                <a href="/notifications">{message('monitoring.openInbox')}</a>
              </AlertDescription>
            </Alert>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
