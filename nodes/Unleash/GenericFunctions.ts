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
 * Picks one flag out of a Frontend API toggle list. The Frontend API leaves out
 * disabled flags, so a missing flag is a normal result: enabled false, disabled variant.
 */
export function toFlagResult(flagName: string, toggles: IToggle[]): FlagResult {
	const toggle = toggles.find((candidate) => candidate.name === flagName);
	if (!toggle) return { name: flagName, enabled: false, variant: { ...DISABLED_VARIANT } };
	return {
		name: toggle.name,
		enabled: toggle.enabled === true,
		variant: toVariant(toggle.variant),
	};
}

/** The shape Unleash Edge's single-feature endpoint returns - enough to build a FlagResult. */
interface SingleFeatureResponse {
	name?: string;
	enabled?: boolean;
	variant?: IVariant;
}

function toFlagResultFromSingleFeature(
	flagName: string,
	body: SingleFeatureResponse,
): FlagResult {
	return {
		name: body.name ?? flagName,
		enabled: body.enabled === true,
		variant: toVariant(body.variant),
	};
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
// Best-effort response cache, with ETag revalidation on Unleash Edge
//
// The Frontend API has no ETag or conditional-request support on a standard
// Unleash server (confirmed from Unleash's own server source: the Frontend
// API controller sets only `Cache-control: no-cache`, nothing conditional).
// Evaluating one flag there still means fetching every flag for the context,
// with no narrower request available - so a time-based cache is the only
// lever on a standard server, and this node polls on a timer the same way
// Unleash's own frontend SDKs do: unleash-proxy-client defaults to the same
// refresh interval as DEFAULT_CACHE_SECONDS above.
//
// Unleash Edge is different: a generic etag middleware wraps its entire
// `/api` router (confirmed from Edge's own source), so every endpoint it
// exposes - the full list and the single-feature endpoint alike - accepts
// `If-None-Match` and can answer 304. That middleware runs *after* the route
// handler, though, so it saves bandwidth, not Edge's evaluation work; the
// time-based cache above is what actually avoids that. Sending
// `If-None-Match` is harmless against a standard server too (it has nothing
// to compare it to, so it just always returns 200), so this node always
// attempts it once the time-based cache goes stale, rather than gating it
// behind the Server Type parameter.
//
// The cache lives in this module's memory rather than n8n's workflow static
// data. That avoids adding a database write to n8n on every cache miss, and
// it lets separate workflows that evaluate the same context against the same
// Unleash instance share one cache entry instead of one each. The one
// tradeoff: a queue-mode n8n install with several worker processes does not
// share this cache between workers - each worker caches on its own.
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
	fetchedAt: number;
	value: T;
	etag?: string;
}

const toggleCache = new Map<string, CacheEntry<IToggle[]>>();
const featureCache = new Map<string, CacheEntry<FlagResult>>();

function isFresh(entry: CacheEntry<unknown>, ttlMs: number): boolean {
	return Date.now() - entry.fetchedAt <= ttlMs;
}

/** Stores a value (and its ETag, if any) regardless of the cache duration setting, so a later
 * call can still revalidate cheaply even when the time-based cache itself is disabled. */
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

/** Identifies a credential without keeping the token itself around as a cache key. */
function credentialFingerprint(credentials: UnleashCredentials): string {
	return createHash('sha256')
		.update(`${credentials.url}:${credentials.token}`)
		.digest('hex')
		.slice(0, 16);
}

function contextCacheKey(context: IContext): string {
	const properties = context.properties ?? {};
	const propertiesPart = Object.keys(properties)
		.sort()
		.map((key) => `${key}=${properties[key]}`)
		.join('&');
	return [
		context.appName,
		context.userId ?? '',
		context.sessionId ?? '',
		context.remoteAddress ?? '',
		propertiesPart,
	].join('|');
}

function getCacheSeconds(this: IExecuteFunctions, itemIndex: number): number {
	const seconds = this.getNodeParameter('cacheSeconds', itemIndex, DEFAULT_CACHE_SECONDS);
	return typeof seconds === 'number' ? seconds : Number(seconds);
}

/**
 * Fetches every flag for a context from `POST {base}`. Returns the cached list without any
 * network call while it is still fresh; once stale, revalidates with `If-None-Match` so Unleash
 * Edge can answer 304 instead of resending the full list (a standard Unleash server ignores the
 * header and just answers 200, so this is always safe to attempt).
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
			method: 'POST',
			url: baseUrl(credentials),
			headers,
			body: { context },
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		})) as IN8nHttpFullResponse;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}

	if (response.statusCode === 304 && cached) {
		touch(toggleCache, cacheKey);
		return cached.value;
	}
	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new NodeApiError(this.getNode(), response.body as JsonObject, {
			itemIndex,
			httpCode: String(response.statusCode),
		});
	}

	const toggles = parseToggles(response.body);
	cacheStore(toggleCache, cacheKey, toggles, getEtag(response));
	return toggles;
}

/**
 * Fetches one flag from Unleash Edge's single-feature endpoint
 * (`GET /api/frontend/features/:flagName`). Only Edge exposes this endpoint - a standard Unleash
 * server does not. Returns the cached result without any network call while it is still fresh;
 * once stale, revalidates with `If-None-Match` so Edge can answer 304 instead of resending the body.
 */
async function fetchSingleFeature(
	this: IExecuteFunctions,
	itemIndex: number,
	credentials: UnleashCredentials,
	context: IContext,
	flagName: string,
): Promise<FlagResult> {
	const cacheSeconds = getCacheSeconds.call(this, itemIndex);
	const cacheKey = `${credentialFingerprint(credentials)}:${flagName}:${contextCacheKey(context)}`;
	const cached = featureCache.get(cacheKey);

	if (cacheSeconds > 0 && cached && isFresh(cached, cacheSeconds * 1000)) {
		return cached.value;
	}

	// Matches unleash-proxy-client's own urlWithContextAsQuery: every context field becomes a
	// query param, and properties are flattened as properties[key]=value rather than JSON-encoded.
	const qs: IDataObject = { appName: context.appName };
	if (context.userId) qs.userId = context.userId;
	if (context.sessionId) qs.sessionId = context.sessionId;
	if (context.remoteAddress) qs.remoteAddress = context.remoteAddress;
	for (const [key, value] of Object.entries(context.properties ?? {})) {
		qs[`properties[${key}]`] = value;
	}

	const headers: IDataObject = { Accept: 'application/json' };
	if (cached?.etag) headers['If-None-Match'] = cached.etag;

	let response: IN8nHttpFullResponse;
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_TYPE, {
			method: 'GET',
			url: `${baseUrl(credentials)}/features/${encodeURIComponent(flagName)}`,
			headers,
			qs,
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		})) as IN8nHttpFullResponse;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}

	if (response.statusCode === 304 && cached) {
		touch(featureCache, cacheKey);
		return cached.value;
	}

	let result: FlagResult;
	if (response.statusCode === 404) {
		// Same convention as the full-list endpoint: a flag Edge doesn't know about is not an error.
		result = { name: flagName, enabled: false, variant: { ...DISABLED_VARIANT } };
	} else if (response.statusCode >= 200 && response.statusCode < 300) {
		result = toFlagResultFromSingleFeature(flagName, response.body as SingleFeatureResponse);
	} else {
		throw new NodeApiError(this.getNode(), response.body as JsonObject, {
			itemIndex,
			httpCode: String(response.statusCode),
		});
	}

	cacheStore(featureCache, cacheKey, result, getEtag(response));
	return result;
}

/** Runs the Evaluate operation for one item. */
export async function evaluateFlag(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<FlagResult> {
	const flagName = String(this.getNodeParameter('flagName', itemIndex, '')).trim();
	const serverType = this.getNodeParameter('serverType', itemIndex, 'unleash');
	const credentials = await this.getCredentials<UnleashCredentials>(CREDENTIAL_TYPE, itemIndex);
	const context = buildContext.call(this, itemIndex);

	const result =
		serverType === 'edge'
			? await fetchSingleFeature.call(this, itemIndex, credentials, context, flagName)
			: toFlagResult(flagName, await fetchAllToggles.call(this, itemIndex, credentials, context));

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
	return toggles.map((toggle) => toFlagResult(toggle.name, [toggle]));
}
