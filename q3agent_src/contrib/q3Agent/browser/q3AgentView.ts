/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Q3 IDE contributors. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import './media/q3Agent.css';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IQ3AgentService, IQ3AgentResponseChunk, IQ3ModelService } from '../../../services/q3Agent/common/q3Agent.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';

interface ChatMessage {
	role: 'user' | 'assistant' | 'tool';
	content: string;
	toolName?: string;
}

export class Q3AgentViewPane extends ViewPane {
	private _chatContainer!: HTMLElement;
	private _inputBox!: HTMLTextAreaElement;
	private _sendButton!: HTMLButtonElement;
	private _stopButton!: HTMLButtonElement;
	private _modelSelector!: HTMLSelectElement;
	private _browsePanelVisible = false;
	private _modelBrowserEl!: HTMLElement;
	private _browseButton!: HTMLButtonElement;
	private _messages: ChatMessage[] = [];
	private _currentAssistantEl: HTMLElement | undefined;
	private _currentAssistantText: string = '';
	private readonly _disposables = new DisposableStore();

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IQ3AgentService private readonly _agentService: IQ3AgentService,
		@IQ3ModelService private readonly _modelService: IQ3ModelService,
		@IEditorService private readonly _editorService: IEditorService,
		@IWorkspaceContextService private readonly _workspaceService: IWorkspaceContextService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const root = container;
		root.classList.add('q3-agent');

		// Model selector bar
		const toolbar = document.createElement('div');
		toolbar.classList.add('q3-agent-toolbar');
		root.appendChild(toolbar);

		const modelLabel = document.createElement('span');
		modelLabel.textContent = 'Model: ';
		modelLabel.classList.add('q3-agent-model-label');
		toolbar.appendChild(modelLabel);

		this._modelSelector = document.createElement('select');
		this._modelSelector.classList.add('q3-agent-model-selector');
		this._modelSelector.addEventListener('change', () => {
			this._modelService.setCurrentModel(this._modelSelector.value);
		});
		toolbar.appendChild(this._modelSelector);

		this._browseButton = document.createElement('button');
		this._browseButton.classList.add('q3-agent-browse-button');
		this._browseButton.textContent = '+';
		this._browseButton.title = 'Browse and download models';
		this._browseButton.addEventListener('click', () => this._toggleModelBrowser());
		toolbar.appendChild(this._browseButton);

		this._refreshModels();

		// Model browser panel (hidden by default)
		this._modelBrowserEl = document.createElement('div');
		this._modelBrowserEl.classList.add('q3-agent-model-browser');
		this._modelBrowserEl.style.display = 'none';
		root.appendChild(this._modelBrowserEl);

		// Chat container
		this._chatContainer = document.createElement('div');
		this._chatContainer.classList.add('q3-agent-chat');
		root.appendChild(this._chatContainer);

		// Welcome message
		this._addMessage({ role: 'assistant', content: 'Welcome to Q3 Agent! I\'m powered by Qwen 3 Coder running locally via Ollama. Ask me anything about your code.' });

		// Input area
		const inputArea = document.createElement('div');
		inputArea.classList.add('q3-agent-input-area');
		root.appendChild(inputArea);

		this._inputBox = document.createElement('textarea');
		this._inputBox.classList.add('q3-agent-input');
		this._inputBox.placeholder = 'Ask Q3 Agent... (Enter to send, Shift+Enter for newline)';
		this._inputBox.rows = 3;
		this._inputBox.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this._sendMessage();
			}
		});
		inputArea.appendChild(this._inputBox);

		const buttonRow = document.createElement('div');
		buttonRow.classList.add('q3-agent-button-row');
		inputArea.appendChild(buttonRow);

		this._sendButton = document.createElement('button');
		this._sendButton.classList.add('q3-agent-send-button');
		this._sendButton.textContent = 'Send';
		this._sendButton.addEventListener('click', () => this._sendMessage());
		buttonRow.appendChild(this._sendButton);

		this._stopButton = document.createElement('button');
		this._stopButton.classList.add('q3-agent-stop-button');
		this._stopButton.textContent = 'Stop';
		this._stopButton.style.display = 'none';
		this._stopButton.addEventListener('click', () => this._agentService.cancel());
		buttonRow.appendChild(this._stopButton);

		// Subscribe to agent events
		this._disposables.add(this._agentService.onDidResponseChunk(chunk => this._handleChunk(chunk)));
		this._disposables.add(this._agentService.onDidStateChange(state => this._handleStateChange(state)));
		this._disposables.add(this._modelService.onDidModelsChange(() => this._refreshModels()));
	}

	private _toggleModelBrowser(): void {
		this._browsePanelVisible = !this._browsePanelVisible;
		this._modelBrowserEl.style.display = this._browsePanelVisible ? '' : 'none';
		if (this._browsePanelVisible) {
			this._renderModelBrowser();
		}
	}

	private _renderModelBrowser(): void {
		this._modelBrowserEl.replaceChildren();

		const presets = this._modelService.getModelPresets();

		const header = document.createElement('div');
		header.classList.add('q3-agent-model-browser-header');
		header.textContent = 'Available Models';
		this._modelBrowserEl.appendChild(header);

		let lastCategory = '';
		const categoryLabels: Record<string, string> = {
			coder: 'Coding',
			general: 'General',
			reasoning: 'Reasoning',
		};

		for (const preset of presets) {
			if (preset.category !== lastCategory) {
				lastCategory = preset.category;
				const catHeader = document.createElement('div');
				catHeader.classList.add('q3-agent-model-category-header');
				catHeader.textContent = categoryLabels[preset.category] || preset.category;
				this._modelBrowserEl.appendChild(catHeader);
			}

			const row = document.createElement('div');
			row.classList.add('q3-agent-model-preset');
			if (preset.cloud) {
				row.classList.add('q3-agent-model-preset-cloud');
			}

			const info = document.createElement('div');
			info.classList.add('q3-agent-model-preset-info');

			const nameEl = document.createElement('div');
			nameEl.classList.add('q3-agent-model-preset-name');
			nameEl.textContent = preset.displayName;
			info.appendChild(nameEl);

			const descEl = document.createElement('div');
			descEl.classList.add('q3-agent-model-preset-desc');
			descEl.textContent = preset.description;
			info.appendChild(descEl);

			const sizeEl = document.createElement('div');
			sizeEl.classList.add('q3-agent-model-preset-size');
			sizeEl.textContent = preset.size;
			info.appendChild(sizeEl);

			row.appendChild(info);

			const actions = document.createElement('div');
			actions.classList.add('q3-agent-model-preset-actions');

			const useBtn = document.createElement('button');
			useBtn.classList.add('q3-agent-model-use-button');
			useBtn.textContent = 'Use';
			useBtn.addEventListener('click', () => {
				this._modelService.setCurrentModel(preset.name);
				this._toggleModelBrowser();
			});
			actions.appendChild(useBtn);

			if (!preset.cloud) {
				const pullBtn = document.createElement('button');
				pullBtn.classList.add('q3-agent-model-pull-button');
				pullBtn.textContent = 'Download';
				pullBtn.addEventListener('click', async () => {
					pullBtn.disabled = true;
					pullBtn.textContent = 'Downloading...';
					try {
						await this._modelService.pullModel(preset.name);
						pullBtn.textContent = 'Done';
					} catch (e: any) {
						pullBtn.textContent = 'Failed';
					}
				});
				actions.appendChild(pullBtn);
			} else {
				const cloudLabel = document.createElement('span');
				cloudLabel.classList.add('q3-agent-model-cloud-label');
				cloudLabel.textContent = 'â˜ Cloud';
				actions.appendChild(cloudLabel);
			}

			row.appendChild(actions);
			this._modelBrowserEl.appendChild(row);
		}
	}

	private async _refreshModels(): Promise<void> {
		const running = await this._modelService.isOllamaRunning();
		if (!running) {
			this._modelSelector.replaceChildren();
			const notRunningOpt = document.createElement('option');
			notRunningOpt.value = '';
			notRunningOpt.textContent = 'Ollama not running';
			this._modelSelector.appendChild(notRunningOpt);
			return;
		}
		const models = await this._modelService.getModels();
		this._modelSelector.replaceChildren();
		if (models.length === 0) {
			const opt = document.createElement('option');
			opt.value = '';
			opt.textContent = 'No models installed';
			this._modelSelector.appendChild(opt);
			return;
		}
		const current = this._modelService.getCurrentModel();
		for (const model of models) {
			const opt = document.createElement('option');
			opt.value = model.name;
			opt.textContent = `${model.name} (${model.parameterSize})`;
			if (model.name === current) {
				opt.selected = true;
			}
			this._modelSelector.appendChild(opt);
		}
	}

	private _sendMessage(): void {
		const text = this._inputBox.value.trim();
		if (!text || this._agentService.isRunning()) { return; }

		this._addMessage({ role: 'user', content: text });
		this._inputBox.value = '';

		// Gather context
		const activeEditor = this._editorService.activeTextEditorControl;
		const context: any = {};
		if (activeEditor) {
			const model = activeEditor.getModel() as ITextModel | undefined;
			if (model) {
				const selection = activeEditor.getSelection();
				const selectedText = selection && !selection.isEmpty() ? model.getValueInRange(selection) : undefined;
				context.activeFile = {
					path: model.uri.fsPath,
					content: model.getValue(),
					language: model.getLanguageId(),
					selection: selectedText,
				};
			}
		}

		// Add workspace root context
		const workspace = this._workspaceService.getWorkspace();
		if (workspace.folders.length > 0) {
			context.workspaceRoot = workspace.folders[0].uri.fsPath;
		}

		this._agentService.send({ prompt: text, context });
	}

	private _addMessage(msg: ChatMessage): void {
		this._messages.push(msg);
		const el = this._createMessageElement(msg);
		this._chatContainer.appendChild(el);
		this._chatContainer.scrollTop = this._chatContainer.scrollHeight;
	}

	private _createMessageElement(msg: ChatMessage): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.classList.add('q3-agent-message', `q3-agent-message-${msg.role}`);

		const avatar = document.createElement('div');
		avatar.classList.add('q3-agent-message-avatar');
		avatar.textContent = msg.role === 'user' ? 'U' : msg.role === 'tool' ? 'T' : 'Q3';
		wrapper.appendChild(avatar);

		const content = document.createElement('div');
		content.classList.add('q3-agent-message-content');

		if (msg.toolName) {
			const toolLabel = document.createElement('div');
			toolLabel.classList.add('q3-agent-tool-label');
			toolLabel.textContent = `Tool: ${msg.toolName}`;
			content.appendChild(toolLabel);
		}

		const textEl = document.createElement('div');
		textEl.classList.add('q3-agent-message-text');
		this._renderMarkdownInto(textEl, msg.content);
		content.appendChild(textEl);

		if (msg.role === 'assistant' && msg.content) {
			const actions = document.createElement('div');
			actions.classList.add('q3-agent-message-actions');
			const copyBtn = document.createElement('button');
			copyBtn.classList.add('q3-agent-copy-button');
			copyBtn.textContent = 'Copy';
			copyBtn.addEventListener('click', () => {
				const textToCopy = msg.content;
				navigator.clipboard.writeText(textToCopy).then(() => {
					copyBtn.textContent = 'Copied!';
					setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
				});
			});
			actions.appendChild(copyBtn);
			content.appendChild(actions);
		}

		wrapper.appendChild(content);
		return wrapper;
	}

	private _renderMarkdownInto(target: HTMLElement, text: string): void {
		target.replaceChildren();
		const parts = text.split(/```/);
		for (let i = 0; i < parts.length; i++) {
			if (i % 2 === 0) {
				const lines = parts[i].split('\n');
				for (let j = 0; j < lines.length; j++) {
					if (j > 0) {
						target.appendChild(document.createElement('br'));
					}
					this._renderInlineMarkdown(target, lines[j]);
				}
			} else {
				const newlineIdx = parts[i].indexOf('\n');
				const codeContent = newlineIdx >= 0 ? parts[i].substring(newlineIdx + 1) : parts[i];
				const pre = document.createElement('pre');
				pre.classList.add('q3-agent-code-block');
				const code = document.createElement('code');
				code.textContent = codeContent.trim();
				pre.appendChild(code);
				target.appendChild(pre);
			}
		}
	}

	private _renderInlineMarkdown(target: HTMLElement, text: string): void {
		const parts = text.split(/`([^`]+)`/g);
		for (let i = 0; i < parts.length; i++) {
			if (i % 2 === 0) {
				if (parts[i]) {
					target.appendChild(document.createTextNode(parts[i]));
				}
			} else {
				const code = document.createElement('code');
				code.classList.add('q3-agent-inline-code');
				code.textContent = parts[i];
				target.appendChild(code);
			}
		}
	}

	private _finalizeStreamingMessage(): void {
		if (!this._currentAssistantEl || !this._currentAssistantText) { return; }

		// Update the last message content
		const lastMsg = this._messages[this._messages.length - 1];
		if (lastMsg && lastMsg.role === 'assistant') {
			lastMsg.content = this._currentAssistantText;
		}

		// Do final markdown render
		const textEl = this._currentAssistantEl.querySelector('.q3-agent-message-text');
		if (textEl) {
			this._renderMarkdownInto(textEl as HTMLElement, this._currentAssistantText);
		}

		// Add copy button
		const content = this._currentAssistantEl.querySelector('.q3-agent-message-content');
		if (content && !content.querySelector('.q3-agent-message-actions')) {
			const actions = document.createElement('div');
			actions.classList.add('q3-agent-message-actions');
			const copyBtn = document.createElement('button');
			copyBtn.classList.add('q3-agent-copy-button');
			copyBtn.textContent = 'Copy';
			copyBtn.addEventListener('click', () => {
				navigator.clipboard.writeText(this._currentAssistantText).then(() => {
					copyBtn.textContent = 'Copied!';
					setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
				});
			});
			actions.appendChild(copyBtn);
			content.appendChild(actions);
		}
	}

	private _handleChunk(chunk: IQ3AgentResponseChunk): void {
		if (chunk.type === 'token') {
			if (!this._currentAssistantEl) {
				this._currentAssistantText = '';
				const msg: ChatMessage = { role: 'assistant', content: '' };
				this._messages.push(msg);
				this._currentAssistantEl = this._createMessageElement(msg);
				this._chatContainer.appendChild(this._currentAssistantEl);
			}
			this._currentAssistantText += chunk.content || '';
			const textEl = this._currentAssistantEl.querySelector('.q3-agent-message-text');
			if (textEl) {
				textEl.textContent = this._currentAssistantText;
			}
			this._chatContainer.scrollTop = this._chatContainer.scrollHeight;
		} else if (chunk.type === 'tool_call') {
			this._finalizeStreamingMessage();
			this._currentAssistantEl = undefined;

			const msg: ChatMessage = {
				role: 'tool',
				content: `Calling ${chunk.toolName}(${chunk.toolArgs})`,
				toolName: chunk.toolName,
			};
			this._addMessage(msg);
		} else if (chunk.type === 'tool_result') {
			const msg: ChatMessage = {
				role: 'tool',
				content: chunk.toolResult || '',
				toolName: chunk.toolName,
			};
			this._addMessage(msg);
		} else if (chunk.type === 'done') {
			this._finalizeStreamingMessage();
			this._currentAssistantEl = undefined;
		} else if (chunk.type === 'error') {
			this._finalizeStreamingMessage();
			this._currentAssistantEl = undefined;
			this._addMessage({ role: 'assistant', content: `Error: ${chunk.error}` });
		}
	}

	private _handleStateChange(state: 'idle' | 'thinking' | 'tool_executing'): void {
		if (state === 'idle') {
			this._sendButton.style.display = '';
			this._stopButton.style.display = 'none';
			this._inputBox.disabled = false;
		} else {
			this._sendButton.style.display = 'none';
			this._stopButton.style.display = '';
			this._inputBox.disabled = true;
		}
	}

	override dispose(): void {
		this._disposables.dispose();
		super.dispose();
	}
}
