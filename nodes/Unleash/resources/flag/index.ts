import type { INodeProperties } from 'n8n-workflow';

import { DEFAULT_CACHE_SECONDS } from '../../GenericFunctions';

const showForFlag = { resource: ['flag'] };
const showForEvaluate = { resource: ['flag'], operation: ['evaluate'] };

export const flagDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showForFlag },
		options: [
			{
				name: 'Evaluate',
				value: 'evaluate',
				action: 'Evaluate a flag',
				description: 'Check whether a flag is enabled for a context and get its variant',
			},
			{
				name: 'Get Enabled',
				value: 'getEnabled',
				action: 'Get enabled flags',
				description: 'Get every flag that is enabled for a context, with its variant',
			},
		],
		default: 'evaluate',
	},
	{
		displayName: 'Flag Name',
		name: 'flagName',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. new-checkout',
		displayOptions: { show: showForEvaluate },
		description:
			'Name of the flag to evaluate. A flag that is disabled, unknown, or outside the token’s projects returns enabled: false.',
	},
	{
		displayName: 'User ID',
		name: 'userId',
		type: 'string',
		default: '',
		displayOptions: { show: showForFlag },
		description:
			'The user to evaluate for. Gradual rollouts use it to give the same user the same result on every run.',
	},
	{
		displayName: 'Session ID',
		name: 'sessionId',
		type: 'string',
		default: '',
		displayOptions: { show: showForFlag },
		description:
			'Used for stickiness when there is no user ID. If both are empty, Unleash picks a random session for each request, so a gradual rollout can give a different result every time.',
	},
	{
		displayName: 'Additional Context',
		name: 'additionalContext',
		type: 'collection',
		placeholder: 'Add Context Field',
		default: {},
		displayOptions: { show: showForFlag },
		options: [
			{
				displayName: 'App Name',
				name: 'appName',
				type: 'string',
				default: 'n8n',
				description: 'Application name sent in the context and in usage metrics',
			},
			{
				displayName: 'Custom Properties',
				name: 'properties',
				type: 'fixedCollection',
				placeholder: 'Add Property',
				default: {},
				typeOptions: { multipleValues: true },
				description: 'Custom context fields used by strategy constraints',
				options: [
					{
						displayName: 'Property',
						name: 'property',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'e.g. plan',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								placeholder: 'e.g. enterprise',
							},
						],
					},
				],
			},
			{
				displayName: 'Remote Address',
				name: 'remoteAddress',
				type: 'string',
				default: '',
				placeholder: 'e.g. 203.0.113.10',
				description:
					'IP address for IP-based strategies. If empty, Unleash uses the IP of the n8n server.',
			},
		],
	},
	{
		displayName: 'Server Type',
		name: 'serverType',
		type: 'options',
		options: [
			{
				name: 'Unleash',
				value: 'unleash',
				description:
					"Fetches every flag for the context, then picks this one out of the list - the only option a standard Unleash server supports",
			},
			{
				name: 'Unleash Edge',
				value: 'edge',
				description: 'Fetches only this flag, using Edge\'s own single-feature endpoint. Only works when the credential\'s Base URL points at Unleash Edge, not a standard Unleash server.',
			},
		],
		default: 'unleash',
		displayOptions: { show: showForEvaluate },
		description: 'Whether the credential above points at a standard Unleash server or at Unleash Edge. Edge exposes a lighter endpoint for evaluating a single flag that a standard Unleash server doesn\'t have.',
	},
	{
		displayName: 'Cache Duration (Seconds)',
		name: 'cacheSeconds',
		type: 'number',
		default: DEFAULT_CACHE_SECONDS,
		typeOptions: { minValue: 0 },
		displayOptions: { show: showForFlag },
		description: 'How long to reuse a previous result for the same context instead of calling Unleash again - the same way Unleash’s own frontend SDKs poll on a timer rather than on every check. Set to 0 to always fetch fresh, e.g. for a kill switch that must react immediately to a flag change.',
	},
	{
		displayName: 'Report Usage',
		name: 'reportUsage',
		type: 'boolean',
		default: false,
		displayOptions: { show: showForEvaluate },
		description: 'Whether to send a usage metric to Unleash for this evaluation, so flags used only in n8n do not show as unused. Off by default, since it is an extra call on every evaluation and Unleash Edge is not designed to take it on a hot path.',
	},
];
