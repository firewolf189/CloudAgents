import { client } from './client';
import type {
	CreateCustomModelRequest,
	CreateCustomModelResponse,
	ListModelResponse,
	ListTTSModelResponse,
	ModelCard,
	TestConnectivityRequest,
	TestConnectivityResponse,
	UpdateCustomModelRequest,
} from './types';

export const modelApi = {
	list: (provider: string) => client.get<ListModelResponse>('/model/', { provider }),

	createCustom: (body: CreateCustomModelRequest) =>
		client.post<CreateCustomModelResponse>('/model/custom', body),

	updateCustom: (id: string, body: UpdateCustomModelRequest) =>
		client.patch<ModelCard>(`/model/custom/${id}`, body),

	deleteCustom: (id: string) => client.delete(`/model/custom/${id}`),

	hideBuiltin: (provider: string, modelName: string) =>
		client.post('/model/hide', { provider, model_name: modelName }),

	unhideBuiltin: (provider: string, modelName: string) =>
		client.post('/model/unhide', { provider, model_name: modelName }),

	testConnectivity: (body: TestConnectivityRequest) =>
		client.post<TestConnectivityResponse>('/model/test', body),
};

export const ttsModelApi = {
	list: (provider: string) => client.get<ListTTSModelResponse>('/tts-model/', { provider }),
};
