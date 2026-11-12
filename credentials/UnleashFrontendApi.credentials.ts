import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class UnleashFrontendApi implements ICredentialType {
	name = 'unleashFrontendApi';

	displayName = 'Unleash Frontend API';

	icon: Icon = { light: 'file:../icons/unleash.svg', dark: 'file:../icons/unleash.dark.svg' };

	documentationUrl = 'https://github.com/Unleash/n8n-nodes-unleash#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'url',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://unleash.example.com/api/frontend',
			description:
				'The Frontend API URL of your Unleash instance or Unleash Edge. It ends in /api/frontend.',
		},
		{
			displayName: 'Frontend Token',
			name: 'token',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'A frontend API token. It is scoped to one environment and can only see enabled flags.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '={{$credentials.token}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.url.replace(/\\/+$/, "")}}',
			url: '',
			method: 'GET',
		},
	};
}
