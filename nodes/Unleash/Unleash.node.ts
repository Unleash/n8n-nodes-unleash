import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';

import { evaluateFlag, getEnabledFlags } from './GenericFunctions';
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

	// Programmatic rather than declarative: evaluating one flag needs a cache check that can skip
	// the HTTP call entirely (n8n's declarative routing always sends the request after preSend
	// runs, so it cannot short-circuit on a cache hit), and Evaluate can call one of two different
	// endpoints depending on the Server Type parameter.
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i);

				switch (operation) {
					case 'evaluate': {
						const result = await evaluateFlag.call(this, i);
						returnData.push({ json: result, pairedItem: { item: i } });
						break;
					}
					case 'getEnabled': {
						const results = await getEnabledFlags.call(this, i);
						for (const result of results) {
							returnData.push({ json: result, pairedItem: { item: i } });
						}
						break;
					}
					default:
						throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
							itemIndex: i,
						});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// GenericFunctions.ts already throws NodeApiError for HTTP failures; only a plain
				// error (e.g. from getNodeParameter) still needs wrapping here.
				const nodeError =
					error instanceof NodeApiError || error instanceof NodeOperationError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
				throw nodeError;
			}
		}

		return [returnData];
	}
}
