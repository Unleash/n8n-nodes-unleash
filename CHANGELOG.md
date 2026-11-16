# Changelog

## 0.1.0 (unreleased)

- Unleash node with the Flag resource: Evaluate and Get Enabled operations, evaluated through the Frontend API.
- Unleash Frontend API credential for Unleash and Unleash Edge.
- Both operations cache their result for 30 seconds by default (**Cache Duration (Seconds)**, matching Unleash's own frontend SDKs' default refresh interval), instead of calling Unleash on every execution. A standard Unleash server has no ETag/conditional-request support and no narrower request than fetching every flag, so caching is the main lever there — set it to 0 to confirm freshness on every execution.
- Once the cache above is stale, both operations revalidate with `If-None-Match` before refetching. Unleash Edge answers with a cheap 304 when nothing changed (confirmed from Edge's own source: a generic ETag middleware wraps every endpoint it exposes), saving bandwidth even at Cache Duration: 0. The header is harmless against a standard Unleash server, which just ignores it, so this isn't gated behind Server Type.
- Evaluate has a new **Server Type** parameter. Set it to Unleash Edge to use Edge's single-feature endpoint (fetches only the requested flag) instead of the full-list endpoint every standard Unleash server is limited to.
- Evaluate's **Report Usage** now defaults to off, since it is an extra call on every evaluation and Unleash Edge is not designed to take that on a hot path.
- The node is now implemented as a programmatic-style node (an `execute` method) rather than declarative routing, which is what makes the cache above possible — n8n's declarative routing has no hook that can skip the HTTP call on a cache hit.
- CI now runs the test suite, not just lint and build.
