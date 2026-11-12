import type { INodeProperties } from 'n8n-workflow';

import { evaluateFlag, getEnabledFlags, sendContext } from '../../GenericFunctions';

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
				routing: {
					request: { method: 'POST', url: '' },
					send: { preSend: [sendContext] },
					output: { postReceive: [evaluateFlag] },
				},
			},
			{
				name: 'Get Enabled',
				value: 'getEnabled',
				action: 'Get enabled flags',
				description: 'Get every flag that is enabled for a context, with its variant',
				routing: {
					request: { method: 'POST', url: '' },
					send: { preSend: [sendContext] },
					output: { postReceive: [getEnabledFlags] },
				},
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
		displayName: 'Report Usage',
		name: 'reportUsage',
		type: 'boolean',
		default: true,
		displayOptions: { show: showForEvaluate },
		description:
			'Whether to send a usage metric to Unleash for this evaluation, so flags used only in n8n do not show as unused',
	},
];
