# Monitoring Settings

Implementation input: the monitoring learning preview v1, captured at `1b769fe93b6dee73e2c54b0756d23d2412a60fb1` on `preview/monitoring-learning-v1`, and the user's subsequent instruction to integrate it directly. The baseline is `261be5b`; the implementation issue is [MON01 #130](https://github.com/CaiZongyuan/axum-saas-template/issues/130).

## Accepted Corrections

- Keep the real monitoring experience in settings: overview, HTTP performance, background tasks, collection and alerts.
- Remove the dedicated chart-learning page, teaching blocks and prototype scenario controls from the application.
- Put a small question mark beside each metric. Its brief explanation opens on hover, keyboard focus and touch, and closes with Escape.
- Use real observations and precise missing-data states. Do not promote simulated preview values into production defaults.
- Restrict detailed monitoring to active Owner/Admin memberships; retain the existing public basic system status.
- Use in-app alerts for this iteration. The user explicitly selected this scope over adding email alerts.
- Keep the existing compact settings shell, bilingual text, semantic light/dark colors, and responsive layout.

## Runtime Responsibilities

Prometheus supplies bounded HTTP aggregates and trends. Current task records supply queue snapshots and execution outcomes. Collector outages must not turn missing metrics into zero or change business readiness. A producer heartbeat proves new application observations; scrape timestamps alone do not.

The persisted rule evaluates five-minute HTTP windows with at least 100 requests. A configured sustained error threshold creates one incident notice for current administrators, and a subsequent valid recovery creates one recovery notice. Missing or stale data cannot prove recovery. A test notice belongs only to the requesting administrator.

Collector addresses, infrastructure startup, retention and external uptime checks remain deployment responsibilities. The settings page exposes actual state and a configured detailed-dashboard link. It cannot install infrastructure or detect its own entire host being unavailable.

## Validation

Use the repository's agreed HTTP, public Worker/notification, React View and real-browser interfaces. Compare the integrated application's structure with v1 while applying the corrections above. Record the actual tested revision and any environment limits in the implementation evidence; this document records acceptance inputs, not a claim that validation is complete.
