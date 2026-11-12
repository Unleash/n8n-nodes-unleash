import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';

import { flagDescription } from './resources/flag';

export class Unleash implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Unleash',
		name: 'unleash',
		icon: { light: 'file:../../icons/unleash.svg', dark: 'file:../../icons/unleash.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle:
			'={{$parameter["operation"] === "evaluate" ? $parameter["flagName"] : "Get enabled flags"}}',
		description: 'Evaluate feature flags with Unleash',
		defaults: {
			name: 'Unleash',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'unleashFrontendApi',
				required: true,
			},
		],
		requestDefaults: {
			baseURL: '={{$credentials.url.replace(/\\/+$/, "")}}',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Flag',
						value: 'flag',
					},
				],
				default: 'flag',
			},
			...flagDescription,
		],
	};
}
