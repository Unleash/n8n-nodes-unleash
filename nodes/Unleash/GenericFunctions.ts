import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	INodeExecutionData,
} from 'n8n-workflow';

import { version } from '../../package.json';

export const CREDENTIAL_TYPE = 'unleashFrontendApi';
export const DEFAULT_APP_NAME = 'n8n';
export const SDK_VERSION = `n8n-nodes-unleash:${version}`;

/** The variant Unleash SDKs return when a flag is disabled or unknown. */
const DISABLED_VARIANT: FlagVariant = { name: 'disabled', enabled: false, feature_enabled: false };

export interface UnleashContext {
	appName: string;
	userId?: string;
	sessionId?: string;
	remoteAddress?: string;
	properties?: Record<string, string>;
}

export interface FlagVariant {
	name: string;
	enabled: boolean;
	feature_enabled?: boolean;
	payload?: { type: string; value: string };
}

export interface FlagResult extends IDataObject {
	name: string;
	enabled: boolean;
	variant: FlagVariant;
}

/** One entry of the `toggles` array returned by `POST /api/frontend`. */
interface FrontendApiToggle {
	name: string;
	enabled: boolean;
	impressionData?: boolean;
	variant?: FlagVariant & { featureEnabled?: boolean };
}

interface AdditionalContext {
	remoteAddress?: string;
	appName?: string;
	properties?: { property?: Array<{ name?: string; value?: unknown }> };
}

function hasValue(value: unknown): boolean {
	return value !== undefined && value !== null && String(value) !== '';
}

/** Builds the Unleash context for the current item from the node parameters. */
export function buildContext(this: IExecuteSingleFunctions): UnleashContext {
	const userId = this.getNodeParameter('userId', '');
	const sessionId = this.getNodeParameter('sessionId', '');
	const additional = this.getNodeParameter('additionalContext', {}) as AdditionalContext;

	const context: UnleashContext = {
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

/** preSend: sends the context in the `context` property, as `POST /api/frontend` expects. */
export async function sendContext(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	requestOptions.body = { context: buildContext.call(this) };
	return requestOptions;
}

function parseToggles(body: unknown): FrontendApiToggle[] {
	const parsed = typeof body === 'string' ? (JSON.parse(body) as unknown) : body;
	const toggles = (parsed as { toggles?: unknown } | undefined)?.toggles;
	return Array.isArray(toggles) ? (toggles as FrontendApiToggle[]) : [];
}

function toVariant(variant: FrontendApiToggle['variant']): FlagVariant {
	if (!variant) return { ...DISABLED_VARIANT, feature_enabled: true };
	const result: FlagVariant = {
		name: variant.name,
		enabled: variant.enabled,
		feature_enabled: variant.feature_enabled ?? variant.featureEnabled ?? true,
	};
	if (variant.payload) result.payload = variant.payload;
	return result;
}

/**
 * Picks one flag out of the Frontend API response. The Frontend API leaves out
 * disabled flags, so a missing flag is a normal result: enabled false, disabled variant.
 */
export function toFlagResult(flagName: string, toggles: FrontendApiToggle[]): FlagResult {
	const toggle = toggles.find((candidate) => candidate.name === flagName);
	if (!toggle) return { name: flagName, enabled: false, variant: { ...DISABLED_VARIANT } };
	return {
		name: toggle.name,
		enabled: toggle.enabled === true,
		variant: toVariant(toggle.variant),
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
	this: IExecuteSingleFunctions,
	result: FlagResult,
	appName: string,
): Promise<void> {
	try {
		const credentials = await this.getCredentials<{ url: string }>(CREDENTIAL_TYPE);
		await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_TYPE, {
			method: 'POST',
			url: `${credentials.url.replace(/\/+$/, '')}/client/metrics`,
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

/** postReceive for Evaluate: returns one item for the flag and reports usage if enabled. */
export async function evaluateFlag(
	this: IExecuteSingleFunctions,
	_items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const flagName = String(this.getNodeParameter('flagName', '')).trim();
	const result = toFlagResult(flagName, parseToggles(response.body));

	if (this.getNodeParameter('reportUsage', true) === true) {
		await reportUsage.call(this, result, buildContext.call(this).appName);
	}

	return [{ json: result }];
}

/**
 * postReceive for Get Enabled: one item per enabled flag, in the same shape as Evaluate.
 * Unleash and Unleash Edge format the raw response slightly differently, so it is normalized.
 */
export async function getEnabledFlags(
	this: IExecuteSingleFunctions,
	_items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const toggles = parseToggles(response.body);
	return toggles.map((toggle) => ({ json: toFlagResult(toggle.name, [toggle]) }));
}
