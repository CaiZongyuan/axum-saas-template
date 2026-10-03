import { useId, useRef, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { Button } from '@saas/ui/components/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@saas/ui/components/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@saas/ui/components/tooltip';
import { useAppMessage } from '../shell/messages';

export function MetricLabel({
  name,
  help,
  iconOnly = false,
}: {
  name: string;
  help: string;
  iconOnly?: boolean;
}) {
  const message = useAppMessage();
  const [open, setOpen] = useState(false);
  const focused = useRef(false);
  const triggerId = useId();
  const contentId = useId();
  return (
    <span className="inline-flex items-center gap-1">
      {iconOnly ? null : name}
      <Tooltip
        open={open}
        onOpenChange={(next, details) => {
          // Touch can synthesize mouseleave after focusing the help button.
          // Keep a focused explanation open; blur, outside press and Escape close it.
          if (!next && details.reason === 'trigger-hover' && focused.current)
            return;
          setOpen(next);
        }}
        triggerId={triggerId}
      >
        <TooltipTrigger
          id={triggerId}
          delay={200}
          closeOnClick={false}
          render={<Button variant="ghost" size="icon-xs" />}
          aria-label={message('monitoring.explain', { name })}
          aria-describedby={open ? contentId : undefined}
          onFocus={() => {
            focused.current = true;
            setOpen(true);
          }}
          onBlur={() => {
            focused.current = false;
            setOpen(false);
          }}
          onClick={() => setOpen(true)}
        >
          <CircleHelp aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent id={contentId}>{help}</TooltipContent>
      </Tooltip>
    </span>
  );
}

export function Metric({
  metric,
  value,
}: {
  metric: string;
  value: ReactNode;
}) {
  const message = useAppMessage();
  const name = message(`monitoring.metric.${metric}`);
  return (
    <Card size="sm" role="group" aria-label={name}>
      <CardHeader>
        <CardTitle>
          <MetricLabel
            name={name}
            help={message(`monitoring.help.${metric}`)}
          />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
