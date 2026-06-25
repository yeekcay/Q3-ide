/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Q3 IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { streamToBuffer } from '../../../../base/common/buffer.js';
import { IQ3LLMBridgeService, IQ3ChatMessage, IQ3ToolDefinition, IQ3ToolCall, IQ3LLMResponse } from './q3Agent.js';

const DEFAULT_LLM_ENDPOINT = 'http://127.0.0.1:11434';

export class Q3LLMBridgeService extends Disposable implements IQ3LLMBridgeService {
	declare readonly _serviceBrand: undefined;

	private _abortController: AbortController | undefined;

	constructor(
		@IConfigurationService private readonly _configService: IConfigurationService,
		@IRequestService private readonly _requestService: IRequestService,
	) {
		super();
	}

	private getEndpoint(): string {
		return this._configService.getValue<string>('q3.agent.endpoint') || DEFAULT_LLM_ENDPOINT;
	}

	cancel(): void {
		if (this._abortController) {
			this._abortController.abort();
			this._abortController = undefined;
		}
	}

	async chat(model: string, messages: IQ3ChatMessage[], tools?: IQ3ToolDefinition[], options?: { temperature?: number; maxTokens?: number }): Promise<IQ3LLMResponse> {
		const body: any = {
			model,
			messages: messages.map(m => ({ role: m.role, content: m.content })),
			stream: false,
			options: {
				temperature: options?.temperature ?? 0.7,
				num_predict: options?.maxTokens ?? 4096,
			},
		};
		if (tools && tools.length > 0) {
			body.tools = tools;
		}

		const respText = await this._request(`${this.getEndpoint()}/api/chat`, JSON.stringify(body));
		const data = JSON.parse(respText) as any;
		return {
			content: data.message?.content || '',
			toolCalls: (data.message?.tool_calls || []).map((tc: any) => ({
				id: tc.id || `call_${Date.now()}`,
				type: 'function' as const,
				function: {
					name: tc.function?.name || '',
					arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {}),
				},
			})),
		};
	}

	async chatStream(model: string, messages: IQ3ChatMessage[], tools: IQ3ToolDefinition[], options: { temperature: number; maxTokens: number }, onToken: (token: string) => void): Promise<IQ3LLMResponse> {
		this._abortController = new AbortController();

		const body: any = {
			model,
			messages: messages.map(m => {
				const msg: any = { role: m.role, content: m.content };
				if (m.toolCalls && m.toolCalls.length > 0) {
					msg.tool_calls = m.toolCalls.map(tc => {
						let args: any;
						try {
							args = JSON.parse(tc.function.arguments);
						} catch {
							args = {};
						}
						return {
							id: tc.id,
							type: tc.type,
							function: {
								name: tc.function.name,
								arguments: args,
							},
						};
					});
				}
				if (m.toolCallId) {
					msg.tool_call_id = m.toolCallId;
				}
				if (m.toolName) {
					msg.name = m.toolName;
				}
				return msg;
			}),
			stream: true,
			tools,
			options: {
				temperature: options.temperature,
				num_predict: options.maxTokens,
			},
		};

		const url = `${this.getEndpoint()}/api/chat`;
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: this._abortController.signal,
		});

		if (!res.ok) {
			const errText = await res.text();
			throw new Error(`Ollama API error: ${res.status} - ${errText}`);
		}

		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		let fullContent = '';
		let toolCalls: IQ3ToolCall[] = [];
		let lineBuffer = '';

		for (;;) {
			const { done, value } = await reader.read();
			if (done) { break; }

			lineBuffer += decoder.decode(value, { stream: true });
			const lines = lineBuffer.split('\n');
			lineBuffer = lines.pop() || '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) { continue; }
				try {
					const data = JSON.parse(trimmed) as any;
					if (data.message?.content) {
						fullContent += data.message.content;
						onToken(data.message.content);
					}
					if (data.message?.tool_calls) {
						toolCalls = data.message.tool_calls.map((tc: any) => ({
							id: tc.id || `call_${Date.now()}_${toolCalls.length}`,
							type: 'function' as const,
							function: {
								name: tc.function?.name || '',
								arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {}),
							},
						}));
					}
				} catch {
					// Partial JSON, ignore
				}
			}
		}

		// Process any remaining data
		const trimmed = lineBuffer.trim();
		if (trimmed) {
			try {
				const data = JSON.parse(trimmed) as any;
				if (data.message?.content) {
					fullContent += data.message.content;
					onToken(data.message.content);
				}
				if (data.message?.tool_calls) {
					toolCalls = data.message.tool_calls.map((tc: any) => ({
						id: tc.id || `call_${Date.now()}_${toolCalls.length}`,
						type: 'function' as const,
						function: {
							name: tc.function?.name || '',
							arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {}),
						},
					}));
				}
			} catch {
				// Ignore
			}
		}

		this._abortController = undefined;
		return { content: fullContent, toolCalls };
	}

	private async _request(url: string, body: string): Promise<string> {
		const context = await this._requestService.request({
			url,
			type: 'POST',
			data: body,
			headers: { 'Content-Type': 'application/json' },
			callSite: 'q3agent',
		}, CancellationToken.None);
		if (context.res.statusCode && (context.res.statusCode < 200 || context.res.statusCode >= 300)) {
			const buffer = await streamToBuffer(context.stream);
			const errorBody = buffer.toString();
			throw new Error(`Ollama API error: ${context.res.statusCode} - ${errorBody}`);
		}
		const buffer = await streamToBuffer(context.stream);
		return buffer.toString();
	}
}

registerSingleton(IQ3LLMBridgeService, Q3LLMBridgeService, InstantiationType.Delayed);
