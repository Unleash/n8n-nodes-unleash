# Changelog

## v0.1.1

- Switch to provenance-backed releases via GitHub Actions — no functional change


## 0.1.0

- Unleash node with the Flag resource: Evaluate (one flag) and Get Enabled (every enabled flag), both evaluated through the Unleash Frontend API ([`#1`](https://github.com/Unleash/n8n-nodes-unleash/pull/1)).
- Unleash Frontend API credential, for Unleash itself or Unleash Edge ([`#1`](https://github.com/Unleash/n8n-nodes-unleash/pull/1)).
- Both operations cache results for 30 seconds by default (**Cache Duration (Seconds)**), the same refresh interval Unleash's own frontend SDKs use, and revalidate efficiently once the cache goes stale rather than refetching blindly ([`#4`](https://github.com/Unleash/n8n-nodes-unleash/pull/4)).
- If Unleash is unreachable, both operations fall back to the last cached result and log a warning instead of failing the workflow ([`#4`](https://github.com/Unleash/n8n-nodes-unleash/pull/4)).
- Evaluate can optionally use a lighter single-flag endpoint (**Lookup Method**), currently only available on Unleash Edge ([`#4`](https://github.com/Unleash/n8n-nodes-unleash/pull/4)).
- Evaluate's **Report Usage** metric is off by default ([`#4`](https://github.com/Unleash/n8n-nodes-unleash/pull/4)).
