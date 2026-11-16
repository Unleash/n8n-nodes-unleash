# Changelog

## 0.1.0 (unreleased)

- Unleash node with the Flag resource: Evaluate (one flag) and Get Enabled (every enabled flag), both evaluated through the Unleash Frontend API.
- Unleash Frontend API credential, for Unleash itself or Unleash Edge.
- Both operations cache results for 30 seconds by default (**Cache Duration (Seconds)**), the same refresh interval Unleash's own frontend SDKs use, and revalidate efficiently once the cache goes stale rather than refetching blindly.
- If Unleash is unreachable, both operations fall back to the last cached result and log a warning instead of failing the workflow.
- Evaluate can optionally use Unleash Edge's single-feature endpoint (**Server Type**), lighter than the default full-flag-list fetch.
- Evaluate's **Report Usage** metric is off by default.
