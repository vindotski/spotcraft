---

title: VictoriaMetrics and VictoriaLogs for monitoring
number: 3
status: accepted
implementation: skeleton
date: 2026-11-07
supersedes: []
superseded_by: []
notes: ""
---

# VictoriaMetrics and VictoriaLogs for monitoring

## Context

The dashboard shows metrics, logs and uptime itself, so the monitoring stack needs
query APIs rather than its own UI, and it should be light enough for a small ops server.

## Decision

- **VictoriaMetrics** stores metrics (Prometheus-compatible queries), fed by **vmagent**.
- **vmagent** scrapes **node-exporter** (host) and **cAdvisor** (containers) on the apps
  server over the private network, and **blackbox-exporter** probes each app's public URL.
- **VictoriaLogs** stores logs, pushed from the apps server over the private network.
- The dashboard queries both over HTTP.

## Consequences

- No Grafana: the dashboard is the UI.
- The log shipper on the apps server is still to be chosen.
