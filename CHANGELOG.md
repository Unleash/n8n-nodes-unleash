# Changelog

## 0.1.0 (unreleased)

- Unleash node with the Flag resource: Evaluate and Get Enabled operations, evaluated through the Frontend API.
- Unleash Frontend API credential for Unleash and Unleash Edge.
- Both operations cache their result for 30 seconds by default (**Cache Duration (Seconds)**, matching Unleash's own frontend SDKs' default refresh interval), instead of calling Unleash on every execution.
- Once the cache above is stale, both operations fetch over `GET` (not `POST`) and revalidate with `If-None-Match`, so a `304` can replace resending the full body when nothing changed. This works against a standard Unleash server, not just Edge: Express, which Unleash's server is built on, always sets an ETag but only honors `If-None-Match` for GET/HEAD, never POST - confirmed from Express's own source after an early version of this wrongly assumed standard Unleash had no ETag support at all.
- If a call to Unleash fails (network error, timeout, gateway problem), both operations fall back to the last cached result and log a warning, instead of failing the workflow outright - the same degrade-gracefully pattern official Unleash SDKs use. Only throws when there's nothing cached yet.
- Evaluate has a new **Server Type** parameter. Set it to Unleash Edge to use Edge's single-feature endpoint (fetches only the requested flag) instead of the full-list endpoint every standard Unleash server is limited to.
- Evaluate's **Report Usage** now defaults to off, since it is an extra call on every evaluation and Unleash Edge is not designed to take that on a hot path.
- The node is now implemented as a programmatic-style node (an `execute` method) rather than declarative routing, which is what makes the cache above possible — n8n's declarative routing has no hook that can skip the HTTP call on a cache hit.
- CI now runs the test suite, not just lint and build.
- Releases now run through Unleash's shared `npm-release.yml` workflow (triggered manually from the Actions tab) instead of a repo-local `publish.yml`, matching how other Unleash npm packages release.
