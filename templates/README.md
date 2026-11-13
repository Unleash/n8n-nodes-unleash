# Templates

Ten ready-made n8n workflows — the [build spec](https://docs.n8n.io/integrations/community-nodes/build-community-nodes/)'s original six, plus four adapted from the worked examples in the main [README](../README.md) — exported as workflow JSON. Each file is a complete n8n workflow: nodes, their settings, and sticky notes that explain the workflow. Import one with **n8n's `...` menu > Import > From File** (or **Import > From URL** if you host the raw file), add your own credentials, and run it.

This folder is the source of truth for these templates — the place to review and version them, test them against new MCP server releases, and link to directly from docs or the landing page. It's also the staging area before submitting to the [n8n template gallery](https://n8n.io/workflows/), which reviews every submission against its [template guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/).

## The ten templates

| Template | Plan | Built from | Tested |
|---|---|---|---|
| [`agent-kill-switch.json`](agent-kill-switch.json) — Agent kill switch: evaluate a flag at the start of an agent workflow and stop when it's off | All plans | Unleash node, If node | ✅ Built and run end to end against a local Unleash instance and this node, both branches (flag on / flag off) |
| [`lifecycle-cleanup.json`](lifecycle-cleanup.json) — Lifecycle cleanup: a flag goes potentially stale or completed, open a Jira ticket for its creator | All plans | Webhook node | ✅ Built and run end to end against the local Unleash instance's real webhook payload shape, including dedup on a duplicate event. The Jira step is structurally correct (`n8n-nodes-base.jira`) but wasn't run against a live Jira — connect your own credential and pick a project/issue type |
| [`guarded-automation.json`](guarded-automation.json) — Guarded automation: pause a scheduled automation with a kill switch | All plans | Unleash node, If node | ✅ Matches the workflow already built and run end to end in n8n for the main README's screenshot (`docs/images/guarded-automation.png`) — imports cleanly here, but wasn't independently re-run against a live Unleash instance in this verification pass |
| [`flag-gated-deploy-gate.json`](flag-gated-deploy-gate.json) — Flag-gated deploy gate: let CI call a webhook, gate the deploy on a flag | All plans | Unleash node, If node, HTTP Request | ✅/⚠️ Matches the workflow built for `docs/images/flag-gated-deploy-gate.png` — the `blocked` branch ran successfully there; the `deployed` branch's HTTP Request intentionally points at a placeholder API and errors, exactly as the screenshot shows. Imports cleanly here |
| [`route-tenant-by-variant.json`](route-tenant-by-variant.json) — Route a tenant by variant: send different tenants to different sub-workflows by Unleash variant | All plans | Unleash node, Switch, Execute Workflow, Merge | ✅ Matches the workflow built for `docs/images/route-tenant-by-variant.png`, run end to end there except the Slack step (no real workspace in this repo). Imports cleanly here. `legacy`/`v2` are placeholder variant names — use your own |
| [`gate-ai-agent-tools-by-flag.json`](gate-ai-agent-tools-by-flag.json) — Gate an AI agent's tools by flag: give an agent an extra, risky tool only when a flag is on | All plans | Unleash node, If node, AI Agent | ⚠️ Matches the workflow built for `docs/images/gate-ai-agent-tools-by-flag.png` — only the advanced branch ran there, and it errors without a Chat Model attached (intentional, to spotlight the tool gating; see the sticky note). Imports cleanly here |
| [`incident-kill-switch.json`](incident-kill-switch.json) — Incident kill switch (Enterprise): an alert from Datadog or PagerDuty turns a feature off, then posts to Slack | Enterprise | MCP Client (`kill_switch`) | ⚠️ Structural only — imports cleanly and the MCP tool arguments match the verified input schema in the `unleash-mcp` source, but this repo has no Enterprise instance to run it against. The `$json.body.flagName` mapping is a placeholder for whatever your alerting tool actually sends |
| [`weekly-cleanup-sweep.json`](weekly-cleanup-sweep.json) — Weekly cleanup sweep (Enterprise): find flags in the completed stage that still get traffic | Enterprise | MCP Client (`search`, `inspect`) | ⚠️ Structural only — same caveat. Input and output field names (`results[0].flags`, `results[0].totals.requests`) are verified against the `unleash-mcp` source, not against a live call |
| [`change-request-approvals.json`](change-request-approvals.json) — Change request approvals (Enterprise): post requests sent to review to the approvers' Slack channel, confirm when applied | Enterprise | Webhook node | ⚠️ Structural only — the webhook/Switch/dedup shape is the same one verified end to end in `lifecycle-cleanup.json`, but change request events only fire on Enterprise, so the event payload itself hasn't been run live |
| [`ops-agent-in-slack.json`](ops-agent-in-slack.json) — Unleash ops agent in Slack (Enterprise): answers "what changed in production today?" and rolls out on request | Enterprise | AI Agent, MCP Client Tool | ⚠️ Structural only — the Slack Trigger's `$json.channel` field (used to reply in the same channel) hasn't been verified against a real Slack event in this repo |

All ten import cleanly into n8n (checked by importing each file into a local instance). "Tested" above means run against something real, not just "imports without errors."

## Uses the community node

Five templates depend on `@unleash/n8n-nodes-unleash` (tested at **v0.1.0**, the version in this repo's `package.json`): **Agent kill switch**, **Guarded automation**, **Flag-gated deploy gate**, **Route a tenant by variant** and **Gate an AI agent's tools by flag**. The other five use only n8n's own built-in nodes (Webhook, If, Switch, Remove Duplicates, Slack, Jira, Schedule Trigger, AI Agent, MCP Client). That means those five can go to the gallery before the node itself is verified — the Enterprise ones also need an Enterprise trial to actually exercise, independent of the node.

## Enterprise requirement

The four Enterprise templates all call the Unleash MCP server, which Unleash Enterprise hosts at `https://<instance>/api/admin/mcp` — see the [MCP integration docs](https://docs.getunleash.io/integrate/mcp). Each one's sticky note links to [Unleash's Enterprise trial](https://www.getunleash.io/plans/enterprise-payg) and carries "(Enterprise)" in its title, matching the n8n gallery convention for plan-gated templates.

## Before submitting to the gallery

Per n8n's [template guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/):
- [x] Each template names a practical use case (above).
- [x] Each template was tested by importing the exact JSON here into a fresh workflow.
- [x] An image for each of the four new community-node templates — reused directly from the main README's worked examples, since the workflows are the same ones shown there (`docs/images/guarded-automation.png`, `flag-gated-deploy-gate.png`, `route-tenant-by-variant.png`, `gate-ai-agent-tools-by-flag.png`).
- [ ] **Not yet done:** an image for `agent-kill-switch.json`, the one remaining community-node template without one, in case the gallery's auto-generated preview doesn't render.
- [x] `agent-kill-switch.json` and the four new community-node templates all name `@unleash/n8n-nodes-unleash` and its tested version (0.1.0) above.

## A note on scope

Submission itself — creating an n8n Creator Portal account and uploading these — is a decision for a person, not something this repo automates: whether the account belongs to Unleash or an individual shows up on every published template's creator profile, and new creators can only submit one template at a time until they reach three approvals. That decision, and the one-at-a-time submission order, are tracked outside this folder.
