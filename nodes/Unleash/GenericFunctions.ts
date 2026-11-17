import { createHash } from 'crypto';

import {
	NodeApiError,
	type IDataObject,
	type IExecuteFunctions,
	type IN8nHttpFullResponse,
	type JsonObject,
} from 'n8n-workflow';
// Types only, from the Unleash JavaScript browser SDK, which calls the same Frontend API.
// The package is a devDependency: type imports are removed at build, so nothing ships at runtime.
import type { IContext, IToggle, IVariant } from 'unleash-proxy-client';

import { version } from '../../package.json';

export const CREDENTIAL_TYPE = 'unleashFrontendApi';
export const DEFAULT_APP_NAME = 'n8n';
export const SDK_VERSION = `n8n-nodes-unleash:${version}`;

/**
 * Matches unleash-proxy-client's own default refresh interval, so this node polls
 * Unleash no more eagerly than Unleash's own frontend SDKs do.
 */
export const DEFAULT_CACHE_SECONDS = 30;

/** Caps how many distinct contexts this process remembers, so caching for many users can't grow without bound. */
const MAX_CACHE_ENTRIES = 500;

/** The variant Unleash SDKs return when a flag is disabled or unknown. */
const DISABLED_VARIANT: IVariant = { name: 'disabled', enabled: false, feature_enabled: false };

export interface FlagResult extends IDataObject {
	name: string;
	enabled: boolean;
	variant: IVariant;
}

interface AdditionalContext {
	remoteAddress?: string;
	appName?: string;
	properties?: { property?: Array<{ name?: string; value?: unknown }> };
}

export interface UnleashCredentials {
	url: string;
	token: string;
}

function hasValue(value: unknown): boolean {
	return value !== undefined && value !== null && String(value) !== '';
}

function baseUrl(credentials: UnleashCredentials): string {
	return credentials.url.replace(/\/+$/, '');
}

/** Builds the Unleash context for one item from the node parameters. */
export function buildContext(this: IExecuteFunctions, itemIndex: number): IContext {
	const userId = this.getNodeParameter('userId', itemIndex, '');
	const sessionId = this.getNodeParameter('sessionId', itemIndex, '');
	const additional = this.getNodeParameter(
		'additionalContext',
		itemIndex,
		{},
	) as AdditionalContext;

	const context: IContext = {
		appName: hasValue(additional.appName) ? String(additional.appName) : DEFAULT_APP_NAME,
	};
	if (hasValue(userId)) context.userId = String(userId);
	if (hasValue(sessionId)) context.sessionId = String(sessionId);
	if (hasValue(additional.remoteAddress)) context.remoteAddress = String(additional.remoteAddress);

	const properties: Record<string, string> = {};
	for (const { name, value } of additional.properties?.property ?? []) {
		// Unleash Edge only accepts string property values, so every value is sent as a string.
		if (hasValue(name)) properties[String(name)] = hasValue(value) ? String(value) : '';
	}
	if (Object.keys(properties).length > 0) context.properties = properties;

	return context;
}

/**
 * Every context field as a query param, matching unleash-proxy-client's own
 * urlWithContextAsQuery: properties are flattened as properties[key]=value rather than
 * JSON-encoded. Unleash's own frontend-api-controller reads a GET request's context from
 * exactly this shape (`req.query`, parsed by Express's qs-based parser), and Edge's
 * single-feature endpoint follows the same convention.
 */
function contextToQueryParams(context: IContext): IDataObject {
	const qs: IDataObject = { appName: context.appName };
	if (context.userId) qs.userId = context.userId;
	if (context.sessionId) qs.sessionId = context.sessionId;
	if (context.remoteAddress) qs.remoteAddress = context.remoteAddress;
	for (const [key, value] of Object.entries(context.properties ?? {})) {
		qs[`properties[${key}]`] = value;
	}
	return qs;
}

function parseToggles(body: unknown): IToggle[] {
	const parsed = typeof body === 'string' ? (JSON.parse(body) as unknown) : body;
	const toggles = (parsed as { toggles?: unknown } | undefined)?.toggles;
	return Array.isArray(toggles) ? (toggles as IToggle[]) : [];
}

function toVariant(variant: IVariant | undefined): IVariant {
	if (!variant) return { ...DISABLED_VARIANT, feature_enabled: true };
	const result: IVariant = {
		name: variant.name,
		enabled: variant.enabled,
		feature_enabled: variant.feature_enabled ?? true,
	};
	if (variant.payload) result.payload = variant.payload;
	return result;
}

/**
 * The result for a flag that wasn't found. Kept as one function so the n8n-facing boundary
 * (evaluateFlag) is the single place that decides what "not found" means - not something
 * buried separately in each fetch path - which is also where a future configurable default
 * would hook in.
 */
function defaultFlagResult(flagName: string): FlagResult {
	return { name: flagName, enabled: false, variant: { ...DISABLED_VARIANT } };
}

/** Builds the result for one toggle from the Frontend API's full-list response. */
function toFlagResult(toggle: IToggle): FlagResult {
	return {
		name: toggle.name,
		enabled: toggle.enabled === true,
		variant: toVariant(toggle.variant),
	};
}

/**
 * The shape Unleash Edge's single-feature endpoint returns on a 200. Confirmed straight from
 * Edge's own source (frontend.rs): name, enabled and variant are always constructed together,
 * never conditionally - a flag it doesn't know about is a 404 (EdgeError::FeatureNotFound), not
 * a 200 with any of these fields missing.
 */
interface SingleFeatureResponse {
	name: string;
	enabled: boolean;
	variant: IVariant;
}

function toFlagResultFromSingleFeature(body: SingleFeatureResponse): FlagResult {
	return { name: body.name, enabled: body.enabled === true, variant: toVariant(body.variant) };
}

/** Body for `POST /api/frontend/client/metrics`: one bucket with this single evaluation. */
export function buildMetrics(result: FlagResult, appName: string, instanceId: string): IDataObject {
	const now = new Date().toISOString();
	return {
		appName,
		instanceId,
		sdkVersion: SDK_VERSION,
		bucket: {
			start: now,
			stop: now,
			toggles: {
				[result.name]: {
					yes: result.enabled ? 1 : 0,
					no: result.enabled ? 0 : 1,
					variants: { [result.variant.name]: 1 },
				},
			},
		},
	};
}

/** Sends one usage metric. Best effort: a failure is logged and never fails the workflow. */
export async function reportUsage(
	this: IExecuteFunctions,
	result: FlagResult,
	appName: string,
	credentials: UnleashCredentials,
): Promise<void> {
	try {
		await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_TYPE, {
			method: 'POST',
			url: `${baseUrl(credentials)}/client/metrics`,
			headers: { 'unleash-sdk': SDK_VERSION },
			body: buildMetrics(result, appName, `n8n-${this.getInstanceId()}`),
			json: true,
			timeout: 10_000,
		});
	} catch (error) {
		this.logger.warn(
			`Unleash: could not report usage for flag "${result.name}": ${(error as Error).message}`,
		);
	}
}

// ---------------------------------------------------------------------------
// Best-effort response cache, with ETag revalidation
//
// A standard Unleash server supports ETag/conditional-GET like any other
// Express app (confirmed from Express's own source: res.send() always sets an
// ETag, and Unleash never disables it), but only on a GET request - Express's
// req.fresh getter, which drives the automatic 304 shortcut, is hard-gated to
// GET/HEAD/QUERY and always returns false for POST. Both fetch functions
// below use GET for exactly this reason. `Cache-control: no-cache` on
// Unleash's own response means "always revalidate", not "no caching exists" -
// it pairs naturally with ETag revalidation, it doesn't rule it out.
//
// Evaluating one flag still means fetching every flag for the context on a
// standard server - there's no narrower request available there (Edge adds
// one; see fetchSingleFeature below) - so a time-based cache is still the
// main lever for that specific cost, same as Unleash's own frontend SDKs
// polling on a timer: unleash-proxy-client defaults to the same refresh
// interval as DEFAULT_CACHE_SECONDS above.
//
// The cache lives in this module's memory rather than n8n's workflow static
// data. That avoids adding a database write to n8n on every cache miss, and
// it lets separate workflows that evaluate the same context against the same
// Unleash instance share one cache entry instead of one each. The one
// tradeoff: each worker in a queue-mode n8n install is its own separate
// Node.js process (confirmed from n8n's own docs), so this cache is not
// shared between workers - each one caches on its own.
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
	fetchedAt: number;
	value: T;
	etag?: string;
}

const toggleCache = new Map<string, CacheEntry<IToggle[]>>();
const featureCache = new Map<string, CacheEntry<FlagResult | null>>();

function isFresh(entry: CacheEntry<unknown>, ttlMs: number): boolean {
	return Date.now() - entry.fetchedAt <= ttlMs;
}

/** Stores a value (and its ETag, if any) regardless of the cache duration setting, so a later
 * call can still revalidate cheaply, or fall back to it on an API error, even when the
 * time-based cache itself is set to 0. */
function cacheStore<T>(
	cache: Map<string, CacheEntry<T>>,
	key: string,
	value: T,
	etag: string | undefined,
): void {
	if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
		// Map iterates in insertion order, so this evicts the oldest entry - a simple
		// approximation of LRU that needs no extra bookkeeping.
		const oldestKey = cache.keys().next().value;
		if (oldestKey !== undefined) cache.delete(oldestKey);
	}
	cache.set(key, { fetchedAt: Date.now(), value, etag });
}

/** Refreshes the timestamp on a 304: the cached value is confirmed current, not just assumed so. */
function touch<T>(cache: Map<string, CacheEntry<T>>, key: string): void {
	const entry = cache.get(key);
	if (entry) entry.fetchedAt = Date.now();
}

function getEtag(response: IN8nHttpFullResponse): string | undefined {
	const headers = response.headers;
	const value = headers.etag ?? headers.ETag ?? headers.Etag;
	return typeof value === 'string' ? value : undefined;
}

/**
 * On an API failure (network error, or an HTTP status that isn't 2xx/304/404), falls back to a
 * cached value - however stale, including one cached from an earlier error - and logs a
 * warning, rather than failing the whole workflow over what's often a transient problem. This
 * is the same degrade-gracefully pattern official Unleash SDKs use. Throws only when there's
 * nothing cached to fall back to.
 *
 * n8n's HTTP client follows redirects by default (it has to be opted out of via
 * disableFollowRedirect, which this node never sets), so a 3xx reaching this function at all
 * means redirects were exhausted or otherwise failed - that's treated as the same kind of
 * failure as any other, covered by the same fallback.
 */
function failOpen<T>(
	execFns: IExecuteFunctions,
	itemIndex: number,
	cached: CacheEntry<T> | undefined,
	description: string,
	cause: Error,
	errorBody?: JsonObject,
): T {
	if (cached) {
		execFns.logger.warn(
			`Unleash: could not ${description} (${cause.message}) - using the last cached result instead.`,
		);
		return cached.value;
	}
	throw new NodeApiError(
		execFns.getNode(),
		errorBody ?? ({ message: cause.message } as JsonObject),
		{ itemIndex },
	);
}

function getCacheSeconds(this: IExecuteFunctions, itemIndex: number): number {
	const seconds = this.getNodeParameter('cacheSeconds', itemIndex, DEFAULT_CACHE_SECONDS);
	return Number(seconds);
}

/**
 * Fetches every flag for a context from `GET {base}`, reusing a cached response within the
 * cache window. Once stale, revalidates with `If-None-Match` so a 304 can replace resending the
 * full body. On an API error, falls back to whatever's cached rather than failing outright.
 */
async function fetchAllToggles(
	this: IExecuteFunctions,
	itemIndex: number,
	credentials: UnleashCredentials,
	context: IContext,
): Promise<IToggle[]> {
	const cacheSeconds = getCacheSeconds.call(this, itemIndex);
	const cacheKey = `${credentialFingerprint(credentials)}:${contextCacheKey(context)}`;
	const cached = toggleCache.get(cacheKey);

	if (cacheSeconds > 0 && cached && isFresh(cached, cacheSeconds * 1000)) {
		return cached.value;
	}

	const headers: IDataObject = { Accept: 'application/json' };
	if (cached?.etag) headers['If-None-Match'] = cached.etag;

	let response: IN8nHttpFullResponse;
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_TYPE, {
			method: 'GET',
			url: baseUrl(credentials),
			headers,
			qs: contextToQueryParams(context),
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		})) as IN8nHttpFullResponse;
	} catch (error) {
		return failOpen(this, itemIndex, cached, 'fetch flags from Unleash', error as Error);
	}

	if (response.statusCode === 304 && cached) {
		touch(toggleCache, cacheKey);
		return cached.value;
	}
	if (response.statusCode < 200 || response.statusCode >= 300) {
		return failOpen(
			this,
			itemIndex,
			cached,
			'fetch flags from Unleash',
			new Error(`unexpected HTTP ${response.statusCode}`),
			response.body as JsonObject,
		);
	}

	const toggles = parseToggles(response.body);
	cacheStore(toggleCache, cacheKey, toggles, getEtag(response));
	return toggles;
}

/**
 * Fetches one flag from Unleash Edge's single-feature endpoint (`GET /api/frontend/features/:flagName`),
 * returning null when Edge confirms the flag doesn't exist - leaving what "not found" defaults to up to
 * the caller. Only Edge exposes this endpoint - a standard Unleash server does not. Reuses a cached
 * response within the cache window; once stale, revalidates with `If-None-Match`. On an API error,
 * falls back to whatever's cached (a confirmed-not-found result included) rather than failing outright.
 */
async function fetchSingleFeature(
	this: IExecuteFunctions,
	itemIndex: number,
	credentials: UnleashCredentials,
	context: IContext,
	flagName: string,
): Promise<FlagResult | null> {
	const cacheSeconds = getCacheSeconds.call(this, itemIndex);
	const cacheKey = `${credentialFingerprint(credentials)}:${flagName}:${contextCacheKey(context)}`;
	const cached = featureCache.get(cacheKey);

	if (cacheSeconds > 0 && cached && isFresh(cached, cacheSeconds * 1000)) {
		return cached.value;
	}

	const headers: IDataObject = { Accept: 'application/json' };
	if (cached?.etag) headers['If-None-Match'] = cached.etag;

	let response: IN8nHttpFullResponse;
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_TYPE, {
			method: 'GET',
			url: `${baseUrl(credentials)}/features/${encodeURIComponent(flagName)}`,
			headers,
			qs: contextToQueryParams(context),
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		})) as IN8nHttpFullResponse;
	} catch (error) {
		return failOpen(
			this,
			itemIndex,
			cached,
			`fetch flag "${flagName}" from Edge`,
			error as Error,
		);
	}

	if (response.statusCode === 304 && cached) {
		touch(featureCache, cacheKey);
		return cached.value;
	}

	let result: FlagResult | null;
	if (response.statusCode === 404) {
		result = null;
	} else if (response.statusCode >= 200 && response.statusCode < 300) {
		result = toFlagResultFromSingleFeature(response.body as SingleFeatureResponse);
	} else {
		return failOpen(
			this,
			itemIndex,
			cached,
			`fetch flag "${flagName}" from Edge`,
			new Error(`unexpected HTTP ${response.statusCode}`),
			response.body as JsonObject,
		);
	}

	cacheStore(featureCache, cacheKey, result, getEtag(response));
	return result;
}

/** Identifies a credential without keeping the token itself around as a cache key. */
function credentialFingerprint(credentials: UnleashCredentials): string {
	return createHash('sha256')
		.update(`${credentials.url}:${credentials.token}`)
		.digest('hex')
		.slice(0, 16);
}

function contextCacheKey(context: IContext): string {
	const properties = context.properties ?? {};
	const propertyEntries = Object.keys(properties)
		.sort()
		.map((key): [string, string] => [key, properties[key]]);

	return JSON.stringify([
		context.appName,
		context.userId ?? null,
		context.sessionId ?? null,
		context.remoteAddress ?? null,
		propertyEntries,
	]);
}

/** Runs the Evaluate operation for one item. */
export async function evaluateFlag(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<FlagResult> {
	const flagName = String(this.getNodeParameter('flagName', itemIndex, '')).trim();
	const lookupMethod = this.getNodeParameter('lookupMethod', itemIndex, 'fullList');
	const credentials = await this.getCredentials<UnleashCredentials>(CREDENTIAL_TYPE, itemIndex);
	const context = buildContext.call(this, itemIndex);

	let result: FlagResult;
	if (lookupMethod === 'singleFlag') {
		const found = await fetchSingleFeature.call(this, itemIndex, credentials, context, flagName);
		result = found ?? defaultFlagResult(flagName);
	} else {
		const toggles = await fetchAllToggles.call(this, itemIndex, credentials, context);
		const toggle = toggles.find((candidate) => candidate.name === flagName);
		result = toggle ? toFlagResult(toggle) : defaultFlagResult(flagName);
	}

	if (this.getNodeParameter('reportUsage', itemIndex, false) === true) {
		await reportUsage.call(this, result, context.appName, credentials);
	}

	return result;
}

/** Runs the Get Enabled operation for one item: one result per flag enabled for the context. */
export async function getEnabledFlags(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<FlagResult[]> {
	const credentials = await this.getCredentials<UnleashCredentials>(CREDENTIAL_TYPE, itemIndex);
	const context = buildContext.call(this, itemIndex);
	const toggles = await fetchAllToggles.call(this, itemIndex, credentials, context);
	return toggles.map(toFlagResult);
}
