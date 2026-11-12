// Unit tests for the declarative hooks. They run against the compiled output in dist/,
// so run `npm test` (which builds first) rather than calling node --test directly.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
	evaluateFlag,
	getEnabledFlags,
	sendContext,
	SDK_VERSION,
} = require('../dist/nodes/Unleash/GenericFunctions.js');
const { version } = require('../package.json');

/** A stand-in for n8n's IExecuteSingleFunctions with just what the hooks use. */
function fakeFunctions({
	params = {},
	url = 'https://unleash.example.com/api/frontend/',
	fail,
} = {}) {
	const requests = [];
	const warnings = [];
	const fns = {
		getNodeParameter: (name, fallback) => (name in params ? params[name] : fallback),
		getCredentials: async () => ({ url, token: 'test-token' }),
		getInstanceId: () => 'abc123',
		logger: { warn: (message) => warnings.push(message) },
		helpers: {
			async httpRequestWithAuthentication(credentialType, options) {
				requests.push({ credentialType, options });
				if (fail) throw new Error(fail);
				return {};
			},
		},
	};
	return { fns, requests, warnings };
}

const response = (toggles) => ({ body: { toggles }, headers: {}, statusCode: 200 });

describe('sendContext', () => {
	it('sends only the default app name when no context is set', async () => {
		const { fns } = fakeFunctions();
		const options = await sendContext.call(fns, { method: 'POST', url: '' });
		assert.deepEqual(options.body, { context: { appName: 'n8n' } });
	});

	it('wraps every context field in a context property and stringifies values', async () => {
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
		const options = await sendContext.call(fns, { method: 'POST', url: '' });
		assert.deepEqual(options.body, {
			context: {
				appName: 'billing-automation',
				userId: '42',
				sessionId: 'session-1',
				remoteAddress: '203.0.113.10',
				properties: { plan: 'enterprise', seats: '25' },
			},
		});
	});
});

describe('evaluateFlag', () => {
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
		const { fns } = fakeFunctions({ params: { flagName: 'new-checkout', reportUsage: false } });
		const items = await evaluateFlag.call(fns, [], response([enabledToggle]));
		assert.deepEqual(items, [
			{
				json: {
					name: 'new-checkout',
					enabled: true,
					variant: {
						name: 'blue',
						enabled: true,
						feature_enabled: true,
						payload: { type: 'json', value: '{"color":"blue"}' },
					},
				},
			},
		]);
	});

	it('returns enabled false with the disabled variant when the flag is absent', async () => {
		const { fns } = fakeFunctions({ params: { flagName: 'unknown-flag', reportUsage: false } });
		const items = await evaluateFlag.call(fns, [], response([enabledToggle]));
		assert.deepEqual(items, [
			{
				json: {
					name: 'unknown-flag',
					enabled: false,
					variant: { name: 'disabled', enabled: false, feature_enabled: false },
				},
			},
		]);
	});

	it('gives an enabled flag without variants the disabled variant with feature_enabled true', async () => {
		const { fns } = fakeFunctions({ params: { flagName: 'plain', reportUsage: false } });
		const [item] = await evaluateFlag.call(fns, [], response([{ name: 'plain', enabled: true }]));
		assert.deepEqual(item.json.variant, {
			name: 'disabled',
			enabled: false,
			feature_enabled: true,
		});
	});

	it('accepts a response body that arrives as a JSON string', async () => {
		const { fns } = fakeFunctions({ params: { flagName: 'new-checkout', reportUsage: false } });
		const [item] = await evaluateFlag.call(fns, [], {
			body: JSON.stringify({ toggles: [enabledToggle] }),
			headers: {},
			statusCode: 200,
		});
		assert.equal(item.json.enabled, true);
	});

	it('reports one usage metric for the evaluation by default', async () => {
		const { fns, requests } = fakeFunctions({
			params: { flagName: 'new-checkout', additionalContext: { appName: 'ops' } },
		});
		await evaluateFlag.call(fns, [], response([enabledToggle]));

		assert.equal(requests.length, 1);
		const [{ credentialType, options }] = requests;
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

	it('counts an absent flag as a "no" with the disabled variant', async () => {
		const { fns, requests } = fakeFunctions({ params: { flagName: 'unknown-flag' } });
		await evaluateFlag.call(fns, [], response([]));
		assert.deepEqual(requests[0].options.body.bucket.toggles, {
			'unknown-flag': { yes: 0, no: 1, variants: { disabled: 1 } },
		});
	});

	it('sends no metric when Report Usage is off', async () => {
		const { fns, requests } = fakeFunctions({
			params: { flagName: 'new-checkout', reportUsage: false },
		});
		await evaluateFlag.call(fns, [], response([enabledToggle]));
		assert.equal(requests.length, 0);
	});

	it('reads the response format of Unleash Edge', async () => {
		const { fns } = fakeFunctions({ params: { flagName: 'plain', reportUsage: false } });
		const edgeToggle = {
			name: 'plain',
			enabled: true,
			variant: { name: 'disabled', enabled: false, payload: null },
			impression_data: false,
			impressionData: false,
		};
		const [item] = await evaluateFlag.call(fns, [], response([edgeToggle]));
		assert.deepEqual(item.json, {
			name: 'plain',
			enabled: true,
			variant: { name: 'disabled', enabled: false, feature_enabled: true },
		});
	});

	it('logs a failed metrics call and still returns the result', async () => {
		const { fns, warnings } = fakeFunctions({
			params: { flagName: 'new-checkout' },
			fail: 'connect ECONNREFUSED',
		});
		const [item] = await evaluateFlag.call(fns, [], response([enabledToggle]));
		assert.equal(item.json.enabled, true);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /new-checkout.*ECONNREFUSED/);
	});
});

describe('getEnabledFlags', () => {
	it('returns one item per enabled flag in the Evaluate shape, for both response formats', async () => {
		const { fns, requests } = fakeFunctions();
		const items = await getEnabledFlags.call(
			fns,
			[],
			response([
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
		);
		assert.deepEqual(
			items.map((item) => item.json),
			[
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
			],
		);
		assert.equal(requests.length, 0, 'Get Enabled never reports usage');
	});

	it('returns no items when no flag is enabled', async () => {
		const { fns } = fakeFunctions();
		assert.deepEqual(await getEnabledFlags.call(fns, [], response([])), []);
	});
});
