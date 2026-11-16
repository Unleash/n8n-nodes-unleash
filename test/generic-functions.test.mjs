// Unit tests for the node's execution logic. They run against the compiled output in dist/,
// so run `npm test` (which builds first) rather than calling node --test directly.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { buildContext, evaluateFlag, getEnabledFlags, SDK_VERSION } = require(
	'../dist/nodes/Unleash/GenericFunctions.js',
);
const { version } = require('../package.json');

/** A stand-in for n8n's IExecuteFunctions with just what GenericFunctions.ts uses. */
function fakeFunctions({
	params = {},
	url = 'https://unleash.example.com/api/frontend/',
	token = 'test-token',
	responses,
	failMetrics,
} = {}) {
	const requests = [];
	const warnings = [];
	let callIndex = 0;
	const fns = {
		getNodeParameter: (name, _itemIndex, fallback) => (name in params ? params[name] : fallback),
		getCredentials: async () => ({ url, token }),
		getInstanceId: () => 'abc123',
		getNode: () => ({ name: 'Unleash' }),
		logger: { warn: (message) => warnings.push(message) },
		helpers: {
			async httpRequestWithAuthentication(credentialType, options) {
				requests.push({ credentialType, options });
				if (failMetrics && options.url.endsWith('/client/metrics')) {
					throw new Error(failMetrics);
				}
				if (responses) {
					const entry = responses[callIndex] ?? responses[responses.length - 1];
					callIndex += 1;
					if (entry && entry.throws) throw new Error(entry.throws);
					return entry;
				}
				return { body: {}, headers: {}, statusCode: 200 };
			},
		},
	};
	return { fns, requests, warnings };
}

const fullListResponse = (toggles, headers = {}) => ({ body: { toggles }, headers, statusCode: 200 });

describe('buildContext', () => {
	it('sends only the default app name when no context is set', () => {
		const { fns } = fakeFunctions();
		assert.deepEqual(buildContext.call(fns, 0), { appName: 'n8n' });
	});

	it('wraps every context field and stringifies values', () => {
		const { fns } = fakeFunctions({
			params: {
				userId: 42,
				sessionId: 'session-1',
				additionalContext: {
					appName: 'billing-automation',
					remoteAddress: '203.0.113.10',
					properties: {
						property: [
							{ name: 'plan', value: 'enterprise' },
							{ name: 'seats', value: 25 },
							{ name: '', value: 'ignored' },
						],
					},
				},
			},
		});
		assert.deepEqual(buildContext.call(fns, 0), {
			appName: 'billing-automation',
			userId: '42',
			sessionId: 'session-1',
			remoteAddress: '203.0.113.10',
			properties: { plan: 'enterprise', seats: '25' },
		});
	});
});

describe('evaluateFlag - standard Unleash server', () => {
	const enabledToggle = {
		name: 'new-checkout',
		enabled: true,
		impressionData: false,
		variant: {
			name: 'blue',
			enabled: true,
			feature_enabled: true,
			featureEnabled: true,
			payload: { type: 'json', value: '{"color":"blue"}' },
		},
	};

	it('returns the flag and its variant when the flag is enabled', async () => {
		const { fns } = fakeFunctions({
			params: { flagName: 'new-checkout', cacheSeconds: 0 },
			responses: [fullListResponse([enabledToggle])],
		});
		const result = await evaluateFlag.call(fns, 0);
		assert.deepEqual(result, {
			name: 'new-checkout',
			enabled: true,
			variant: {
				name: 'blue',
				enabled: true,
				feature_enabled: true,
				payload: { type: 'json', value: '{"color":"blue"}' },
			},
		});
	});

	it('fetches via GET with the context as query params, not a POST body', async () => {
		const { fns, requests } = fakeFunctions({
			params: {
				flagName: 'new-checkout',
				cacheSeconds: 0,
				userId: 'u1',
				additionalContext: { properties: { property: [{ name: 'plan', value: 'enterprise' }] } },
			},
			responses: [fullListResponse([enabledToggle])],
		});
		await evaluateFlag.call(fns, 0);
		const [{ options }] = requests;
		assert.equal(options.method, 'GET');
		assert.equal(options.body, undefined);
		assert.equal(options.qs.userId, 'u1');
		assert.equal(options.qs.appName, 'n8n');
		assert.equal(options.qs['properties[plan]'], 'enterprise');
	});

	it('returns enabled false with the disabled variant when the flag is absent', async () => {
		const { fns } = fakeFunctions({
			params: { flagName: 'unknown-flag', cacheSeconds: 0 },
			responses: [fullListResponse([enabledToggle])],
		});
		const result = await evaluateFlag.call(fns, 0);
		assert.deepEqual(result, {
			name: 'unknown-flag',
			enabled: false,
			variant: { name: 'disabled', enabled: false, feature_enabled: false },
		});
	});

	it('gives an enabled flag without variants the disabled variant with feature_enabled true', async () => {
		const { fns } = fakeFunctions({
			params: { flagName: 'plain', cacheSeconds: 0 },
			responses: [fullListResponse([{ name: 'plain', enabled: true }])],
		});
		const result = await evaluateFlag.call(fns, 0);
		assert.deepEqual(result.variant, { name: 'disabled', enabled: false, feature_enabled: true });
	});

	it('accepts a response body that arrives as a JSON string', async () => {
		const { fns } = fakeFunctions({
			params: { flagName: 'new-checkout', cacheSeconds: 0 },
			responses: [
				{ body: JSON.stringify({ toggles: [enabledToggle] }), headers: {}, statusCode: 200 },
			],
		});
		const result = await evaluateFlag.call(fns, 0);
		assert.equal(result.enabled, true);
	});

	it('reads the response format of Unleash Edge', async () => {
		const { fns } = fakeFunctions({
			params: { flagName: 'plain', cacheSeconds: 0 },
			responses: [
				fullListResponse([
					{
						name: 'plain',
						enabled: true,
						variant: { name: 'disabled', enabled: false, payload: null },
						impression_data: false,
						impressionData: false,
					},
				]),
			],
		});
		const result = await evaluateFlag.call(fns, 0);
		assert.deepEqual(result, {
			name: 'plain',
			enabled: true,
			variant: { name: 'disabled', enabled: false, feature_enabled: true },
		});
	});

	it('does not report usage by default', async () => {
		const { fns, requests } = fakeFunctions({
			params: { flagName: 'new-checkout', cacheSeconds: 0 },
			responses: [fullListResponse([enabledToggle])],
		});
		await evaluateFlag.call(fns, 0);
		assert.equal(requests.length, 1, 'only the evaluate request, no metrics request');
	});

	it('reports one usage metric when Report Usage is on', async () => {
		const { fns, requests } = fakeFunctions({
			params: {
				flagName: 'new-checkout',
				cacheSeconds: 0,
				reportUsage: true,
				additionalContext: { appName: 'ops' },
			},
			responses: [fullListResponse([enabledToggle]), { body: {}, headers: {}, statusCode: 200 }],
		});
		await evaluateFlag.call(fns, 0);

		assert.equal(requests.length, 2);
		const [, { credentialType, options }] = requests;
		assert.equal(credentialType, 'unleashFrontendApi');
		assert.equal(options.method, 'POST');
		assert.equal(options.url, 'https://unleash.example.com/api/frontend/client/metrics');
		assert.equal(options.headers['unleash-sdk'], `n8n-nodes-unleash:${version}`);
		assert.equal(options.body.appName, 'ops');
		assert.equal(options.body.instanceId, 'n8n-abc123');
		assert.equal(options.body.sdkVersion, SDK_VERSION);
		assert.deepEqual(options.body.bucket.toggles, {
			'new-checkout': { yes: 1, no: 0, variants: { blue: 1 } },
		});
		assert.ok(!Number.isNaN(Date.parse(options.body.bucket.start)));
	});

	it('logs a failed metrics call and still returns the result', async () => {
		const { fns, warnings } = fakeFunctions({
			params: { flagName: 'new-checkout', cacheSeconds: 0, reportUsage: true },
			responses: [fullListResponse([enabledToggle])],
			failMetrics: 'connect ECONNREFUSED',
		});
		const result = await evaluateFlag.call(fns, 0);
		assert.equal(result.name, 'new-checkout');
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /new-checkout.*ECONNREFUSED/);
	});

	it('caches the full flag list across calls within the cache window, keyed by context', async () => {
		const { fns, requests } = fakeFunctions({
			params: { flagName: 'new-checkout', cacheSeconds: 30, userId: 'cache-test-user' },
			responses: [fullListResponse([enabledToggle])],
		});
		const first = await evaluateFlag.call(fns, 0);
		const second = await evaluateFlag.call(fns, 0);
		assert.deepEqual(first, second);
		assert.equal(requests.length, 1, 'the second call reused the cached response');
	});

	it('does not cache when Cache Duration is 0', async () => {
		const { fns, requests } = fakeFunctions({
			params: { flagName: 'new-checkout', cacheSeconds: 0, userId: 'no-cache-user' },
			responses: [fullListResponse([enabledToggle]), fullListResponse([enabledToggle])],
		});
		await evaluateFlag.call(fns, 0);
		await evaluateFlag.call(fns, 0);
		assert.equal(requests.length, 2);
	});

	it('fetches separately for different contexts even with caching on', async () => {
		const { fns, requests } = fakeFunctions({
			params: { flagName: 'new-checkout', cacheSeconds: 30 },
			responses: [fullListResponse([enabledToggle]), fullListResponse([enabledToggle])],
		});
		fns.getNodeParameter = (name, _itemIndex, fallback) => {
			if (name === 'userId') return fns.__userId;
			const params = { flagName: 'new-checkout', cacheSeconds: 30 };
			return name in params ? params[name] : fallback;
		};
		fns.__userId = 'user-a';
		await evaluateFlag.call(fns, 0);
		fns.__userId = 'user-b';
		await evaluateFlag.call(fns, 0);
		assert.equal(requests.length, 2, 'different contexts must not share a cache entry');
	});

	it('revalidates with If-None-Match once the cache is stale, and reuses a 304', async () => {
		const { fns, requests } = fakeFunctions({
			params: { flagName: 'new-checkout', cacheSeconds: 0, userId: 'etag-test-user' },
			responses: [
				fullListResponse([enabledToggle], { etag: '"v1"' }),
				{ body: '', headers: {}, statusCode: 304 },
			],
		});
		const first = await evaluateFlag.call(fns, 0);
		const second = await evaluateFlag.call(fns, 0);
		assert.deepEqual(first, second, 'a 304 must reuse the previously cached result');
		assert.equal(requests.length, 2, 'cacheSeconds: 0 still revalidates over the network');
		assert.equal(requests[0].options.headers['If-None-Match'], undefined, 'nothing cached yet');
		assert.equal(requests[1].options.headers['If-None-Match'], '"v1"');
	});

	it('falls back to a stale cached result and logs a warning on an API error', async () => {
		const { fns, requests, warnings } = fakeFunctions({
			params: { flagName: 'new-checkout', cacheSeconds: 0, userId: 'fail-open-user' },
			responses: [fullListResponse([enabledToggle]), { throws: 'socket hang up' }],
		});
		const first = await evaluateFlag.call(fns, 0);
		const second = await evaluateFlag.call(fns, 0);
		assert.deepEqual(second, first, 'falls back to the last cached result rather than failing');
		assert.equal(requests.length, 2);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /socket hang up.*cached/);
	});

	it('throws when an API error occurs and nothing is cached yet', async () => {
		const { fns } = fakeFunctions({
			params: { flagName: 'new-checkout', cacheSeconds: 0, userId: 'cold-fail-user' },
			responses: [{ throws: 'socket hang up' }],
		});
		await assert.rejects(() => evaluateFlag.call(fns, 0));
	});

	it('falls back to cache on an unexpected non-2xx/304 status too', async () => {
		const { fns, warnings } = fakeFunctions({
			params: { flagName: 'new-checkout', cacheSeconds: 0, userId: 'fail-open-status-user' },
			responses: [
				fullListResponse([enabledToggle]),
				{ body: { error: 'bad gateway' }, headers: {}, statusCode: 502 },
			],
		});
		const first = await evaluateFlag.call(fns, 0);
		const second = await evaluateFlag.call(fns, 0);
		assert.deepEqual(second, first);
		assert.equal(warnings.length, 1);
	});
});

describe('evaluateFlag - Unleash Edge single-feature endpoint', () => {
	it('calls the single-feature endpoint via GET and maps its response', async () => {
		const { fns, requests } = fakeFunctions({
			params: { flagName: 'new-checkout', serverType: 'edge', cacheSeconds: 0, userId: 'u1' },
			responses: [
				{
					body: { name: 'new-checkout', enabled: true, variant: { name: 'blue', enabled: true } },
					headers: {},
					statusCode: 200,
				},
			],
		});
		const result = await evaluateFlag.call(fns, 0);
		assert.deepEqual(result, {
			name: 'new-checkout',
			enabled: true,
			variant: { name: 'blue', enabled: true, feature_enabled: true },
		});

		assert.equal(requests.length, 1);
		const [{ options }] = requests;
		assert.equal(options.method, 'GET');
		assert.equal(options.url, 'https://unleash.example.com/api/frontend/features/new-checkout');
		assert.equal(options.qs.userId, 'u1');
		assert.equal(options.qs.appName, 'n8n');
	});

	it('flattens custom properties as properties[key], matching the frontend SDK', async () => {
		const { fns, requests } = fakeFunctions({
			params: {
				flagName: 'new-checkout',
				serverType: 'edge',
				cacheSeconds: 0,
				additionalContext: {
					properties: { property: [{ name: 'plan', value: 'enterprise' }] },
				},
			},
			responses: [{ body: { name: 'new-checkout', enabled: false }, headers: {}, statusCode: 200 }],
		});
		await evaluateFlag.call(fns, 0);
		const [{ options }] = requests;
		assert.equal(options.qs['properties[plan]'], 'enterprise');
	});

	it('treats a 404 as a disabled flag rather than an error', async () => {
		const { fns } = fakeFunctions({
			params: { flagName: 'unknown-flag', serverType: 'edge', cacheSeconds: 0 },
			responses: [{ body: { error: 'not found' }, headers: {}, statusCode: 404 }],
		});
		const result = await evaluateFlag.call(fns, 0);
		assert.deepEqual(result, {
			name: 'unknown-flag',
			enabled: false,
			variant: { name: 'disabled', enabled: false, feature_enabled: false },
		});
	});

	it('throws a node error for any other failing status code, with nothing cached', async () => {
		const { fns } = fakeFunctions({
			params: { flagName: 'secret-flag', serverType: 'edge', cacheSeconds: 0 },
			responses: [{ body: { error: 'forbidden' }, headers: {}, statusCode: 403 }],
		});
		await assert.rejects(() => evaluateFlag.call(fns, 0));
	});

	it('falls back to a cached confirmed-not-found result on a later API error', async () => {
		const { fns, warnings } = fakeFunctions({
			params: { flagName: 'unknown-flag', serverType: 'edge', cacheSeconds: 0, userId: 'u-404' },
			responses: [
				{ body: { error: 'not found' }, headers: {}, statusCode: 404 },
				{ throws: 'socket hang up' },
			],
		});
		const first = await evaluateFlag.call(fns, 0);
		const second = await evaluateFlag.call(fns, 0);
		assert.deepEqual(second, first);
		assert.equal(warnings.length, 1);
	});

	it('caches single-feature responses separately per flag name', async () => {
		const { fns, requests } = fakeFunctions({
			params: {
				flagName: 'new-checkout',
				serverType: 'edge',
				cacheSeconds: 30,
				userId: 'separate-cache-test',
			},
			responses: [{ body: { name: 'new-checkout', enabled: true }, headers: {}, statusCode: 200 }],
		});
		await evaluateFlag.call(fns, 0);
		await evaluateFlag.call(fns, 0);
		assert.equal(requests.length, 1);
	});

	it('revalidates with If-None-Match once the cache is stale, and reuses a 304', async () => {
		const { fns, requests } = fakeFunctions({
			params: {
				flagName: 'new-checkout',
				serverType: 'edge',
				cacheSeconds: 0,
				userId: 'etag-edge-test',
			},
			responses: [
				{ body: { name: 'new-checkout', enabled: true }, headers: { etag: '"v1"' }, statusCode: 200 },
				{ body: '', headers: {}, statusCode: 304 },
			],
		});
		const first = await evaluateFlag.call(fns, 0);
		const second = await evaluateFlag.call(fns, 0);
		assert.deepEqual(first, second);
		assert.equal(requests.length, 2);
		assert.equal(requests[1].options.headers['If-None-Match'], '"v1"');
	});
});

describe('getEnabledFlags', () => {
	it('returns one item per enabled flag in the Evaluate shape, for both response formats', async () => {
		const { fns, requests } = fakeFunctions({
			params: { cacheSeconds: 0, userId: 'get-enabled-test' },
			responses: [
				fullListResponse([
					{
						name: 'from-unleash',
						enabled: true,
						impressionData: false,
						variant: { name: 'blue', enabled: true, feature_enabled: true, featureEnabled: true },
					},
					{
						name: 'from-edge',
						enabled: true,
						impression_data: false,
						variant: { name: 'disabled', enabled: false, payload: null },
					},
				]),
			],
		});
		const results = await getEnabledFlags.call(fns, 0);
		assert.deepEqual(results, [
			{
				name: 'from-unleash',
				enabled: true,
				variant: { name: 'blue', enabled: true, feature_enabled: true },
			},
			{
				name: 'from-edge',
				enabled: true,
				variant: { name: 'disabled', enabled: false, feature_enabled: true },
			},
		]);
		assert.equal(requests.length, 1, 'Get Enabled never reports usage');
	});

	it('returns no items when no flag is enabled', async () => {
		const { fns } = fakeFunctions({
			params: { cacheSeconds: 0, userId: 'no-flags-enabled-test' },
			responses: [fullListResponse([])],
		});
		assert.deepEqual(await getEnabledFlags.call(fns, 0), []);
	});
});
