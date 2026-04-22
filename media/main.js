(function () {
    const vscode = acquireVsCodeApi();
    const messagesContainer = document.getElementById('messages');
    const chatInput = document.getElementById('chat-input');
    const modelSelect = document.getElementById('model-select');
    const modeSelect = document.getElementById('mode-select');
    const micButton = document.getElementById('mic-button');
    const sendButton = document.getElementById('send-button');
    const stopButton = document.getElementById('stop-button');
    const continueButton = document.getElementById('continue-button');
    const addButton = document.getElementById('add-button');
    const attachmentsContainer = document.getElementById('attachments-container');

    let attachments = [];

    // Helper to get folder/file format
    function getShortPath(fullPath) {
        if (!fullPath || fullPath === 'file' || fullPath === 'workspace') return fullPath;
        const parts = fullPath.split(/[\\/]/).filter(p => p.length > 0);
        if (parts.length > 1) {
            return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
        }
        return parts[0] || fullPath;
    }

    // Dynamic state for Mode and Model
    const modes = [
        { name: 'Fast', description: 'Quick answers (Chat mode)' },
        { name: 'Planning', description: 'Build & Fix (Agent mode)' }
    ];
    let currentModeIndex = 0;

    const initialModel = modelSelect ? modelSelect.innerText.trim() : 'gpt-4o';
    let models = [
        { name: initialModel, provider: 'OpenAI' }
    ];
    let currentModelIndex = 0;
    let isGenerating = false;
if (!chatInput) {
        console.error('Chat input element not found!');
        return;
    }

    // Auto-expand textarea as user types
    function autoExpandTextarea() {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
    }

    // Toggle send button visibility based on input
    function toggleSendButton() {
        if (isGenerating) return;

        const hasText = chatInput.value.trim().length > 0;
        const hasAttachments = attachments.length > 0;
        const canSend = hasText || hasAttachments;

        if (sendButton) {
            sendButton.style.display = canSend ? 'flex' : 'none';
        }
        if (micButton) {
            micButton.style.display = canSend ? 'none' : 'flex';
        }
        if (stopButton) {
            stopButton.style.display = 'none';
        }
        if (continueButton) {
            continueButton.style.display = 'none';
        }
    }

    function setGenerating(generating) {
        isGenerating = generating;
        if (generating) {
            if (stopButton) stopButton.style.display = 'flex';
            if (continueButton) continueButton.style.display = 'flex';
            if (sendButton) sendButton.style.display = 'none';
            if (micButton) micButton.style.display = 'none';
            // showTypingIndicator(); // Replaced by activity bar
            updateActivityBar('Thinking...');
        } else {
            if (stopButton) stopButton.style.display = 'none';
            if (continueButton) continueButton.style.display = 'none';
            hideTypingIndicator();
            hideActivityBar();
            toggleSendButton();
        }
    }


    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    chatInput.addEventListener('input', () => {
        autoExpandTextarea();
        toggleSendButton();
    });

    // Configure Marked with Prism Highlighting
    if (typeof marked !== 'undefined') {
        const renderer = new marked.Renderer();
        renderer.code = function (codeOrObj, lang) {
            let code = codeOrObj;
            let language = lang;

            // Handle newer marked versions where the first argument is an object
            if (typeof codeOrObj === 'object' && codeOrObj !== null) {
                code = codeOrObj.text;
                language = codeOrObj.lang;
            }

            const validLang = Prism.languages[language] ? language : 'plain';
            const highlighted = validLang !== 'plain'
                ? Prism.highlight(code, Prism.languages[language], language)
                : code;

            return `<div class="code-block-container">
                <div class="code-header">
                    <span class="code-lang">${language || 'text'}</span>
                    <div class="code-actions">
                        <button class="icon-btn copy-btn" title="Copy code" data-code="${encodeURIComponent(code)}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                        <button class="icon-btn apply-btn" title="Apply change" data-code="${encodeURIComponent(code)}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </button>
                    </div>
                </div>
                <pre class="language-${validLang}"><code>${highlighted}</code></pre>
            </div>`;
        };
        marked.setOptions({ renderer });
    }

    let highlightTimeout = null;
    function getFileTypeBadge(filename) {
        if (!filename) return '';
        const ext = filename.split('.').pop().toLowerCase();
        const badges = {
            'js': '<span class="file-badge badge-js">JS</span>',
            'ts': '<span class="file-badge badge-ts">TS</span>',
            'css': '<span class="file-badge badge-css">CSS</span>',
            'html': '<span class="file-badge badge-html">HTML</span>',
            'py': '<span class="file-badge badge-py">PY</span>',
            'json': '<span class="file-badge badge-json">JSON</span>',
            'md': '<span class="file-badge badge-md">MD</span>',
            'rs': '<span class="file-badge badge-rs">RS</span>',
            'go': '<span class="file-badge badge-go">GO</span>',
            'java': '<span class="file-badge badge-java">JAVA</span>',
            'php': '<span class="file-badge badge-php">PHP</span>',
            'rb': '<span class="file-badge badge-rb">RB</span>',
            'cs': '<span class="file-badge badge-cs">C#</span>'
        };
        return badges[ext] || '';
    }

    function addMessage(text, role) {

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}-message`;

        // Detect potential file paths and make them clickable
        const linkedText = text.replace(/([a-zA-Z]:\\[\\\w\.\/-]+|(?:\/|.\/)[\w\.\/-]+)/g, match => {
            if (match.includes('.') && match.length > 3) {
                return `<span class="file-link" data-path="${match}">${match}</span>`;
            }
            return match;
        });

        if (role === 'user') {
            const rawHtml = typeof marked !== 'undefined' ? marked.parse(linkedText) : linkedText;
            msgDiv.innerHTML = `
            <div class="user-message-content">
                <div class="message-text">${rawHtml}</div>
                <button class="resend-btn" title="Resend message">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 14l-5-5 5-5"></path>
                        <path d="M4 9h12a5 5 0 015 5v3"></path>
                    </svg>
                </button>
            </div>
        `;

            const resendBtn = msgDiv.querySelector('.resend-btn');
            if (resendBtn) {
                resendBtn.addEventListener('click', () => {
                    if (chatInput) {
                        chatInput.value = text;
                        autoExpandTextarea();
                        toggleSendButton();
                        chatInput.focus();
                    }
                });
            }
        } else {
            msgDiv.innerHTML = typeof marked !== 'undefined' ? marked.parse(linkedText) : linkedText;
        }

        messagesContainer.appendChild(msgDiv);

        // Throttled Prism highlighting
        if (highlightTimeout) clearTimeout(highlightTimeout);
        highlightTimeout = setTimeout(() => {
            Prism.highlightAllUnder(messagesContainer);
        }, 250);

        scrollToBottom();
        return msgDiv;
    }

    function scrollToBottom() {
        messagesContainer.scrollTo({
            top: messagesContainer.scrollHeight,
            behavior: 'smooth'
        });
    }

    function showTypingIndicator(text = '') {
        const existing = document.getElementById('typing-indicator');
        if (existing) {
            if (text) {
                const statusText = existing.querySelector('.typing-status');
                if (statusText) statusText.innerText = text;
            }
            return;
        }

        const indicator = document.createElement('div');
        indicator.id = 'typing-indicator';
        indicator.className = 'typing-indicator';
        indicator.innerHTML = `
            <div class="typing-dots">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
            ${text ? `<div class="typing-status">${text}</div>` : ''}
        `;
        messagesContainer.appendChild(indicator);
        scrollToBottom();
    }


    function hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();
    }

    function updateActivityBar(text) {
        const bar = document.getElementById('agent-activity-bar');
        const statusText = document.getElementById('agent-status-text');
        if (bar && statusText) {
            bar.style.display = 'flex';
            statusText.textContent = text || 'Processing...';
        }
    }

    function hideActivityBar() {
        const bar = document.getElementById('agent-activity-bar');
        if (bar) {
            bar.style.display = 'none';
        }
    }


    function addAttachment(name, path, iconType) {
        attachments.push({ name, path, icon: iconType });
        renderAttachments();
        toggleSendButton();
    }

    function renderAttachments() {
        if (!attachmentsContainer) return;

        if (attachments.length === 0) {
            attachmentsContainer.style.display = 'none';
            attachmentsContainer.innerHTML = '';
            return;
        }

        attachmentsContainer.style.display = 'flex';
        attachmentsContainer.innerHTML = '';

        attachments.forEach((attachment, index) => {
            const chip = document.createElement('div');
            chip.className = 'attachment-chip';

            let icon = '📄';
            if (attachment.icon === 'media') icon = '🖼️';

            chip.innerHTML = `
                <span class="attachment-icon">${icon}</span>
                <span class="attachment-name" title="${attachment.path}">${attachment.name}</span>
                <span class="attachment-remove" data-index="${index}">×</span>
            `;

            chip.querySelector('.attachment-remove').onclick = (e) => {
                e.stopPropagation();
                attachments.splice(index, 1);
                renderAttachments();
            };

            attachmentsContainer.appendChild(chip);
        });
    }

    function updateBudgetIndicator(budget) {
        const indicator = document.getElementById('budget-indicator');
        if (!indicator) return;

        const statusClass = budget.status === 'critical' ? 'critical' :
            budget.status === 'warning' ? 'warning' : 'healthy';

        const cachedText = budget.cached ? `<span class="budget-cached" style="font-size: 0.85em; opacity: 0.8; margin-left: 4px;">(${budget.cached.toLocaleString()} cached)</span>` : '';

        indicator.className = `budget-indicator ${statusClass}`;
        indicator.innerHTML = `
            <span class="budget-icon">🎯</span>
            <span class="budget-text">${budget.percentUsed}% used</span>
            <span class="budget-detail">${budget.used.toLocaleString()}/${budget.total.toLocaleString()} ${cachedText}</span>
        `;
    }

    function showToolError(tool, error) {
        const lastTool = [...document.querySelectorAll('.tool-call')].pop();
        if (lastTool) {
            lastTool.classList.add('tool-error');
            const header = lastTool.querySelector('.tool-header');
            if (header) {
                header.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff4444" stroke-width="3">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span>${tool} Failed</span>
            `;
            }
            const errorDiv = document.createElement('div');
            errorDiv.className = 'tool-error-message';
            errorDiv.innerText = error;
            lastTool.appendChild(errorDiv);
        }
    }

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'addMessage':
                addMessage(message.text, message.role);
                break;

            case 'statusUpdate':
                if (message.text) {
                    showTypingIndicator(message.text);
                    updateActivityBar(message.text);
                } else {
                    hideTypingIndicator();
                    hideActivityBar();
                }
                break;

            case 'generationStopped':
                setGenerating(false);
                hideTypingIndicator();
                hideActivityBar();
                if (message.text) {
                    addMessage(message.text, 'bot');
                }
                break;

            case 'setModels':
                if (message.models && message.models.length > 0) {
                    models = message.models;
                    const idx = models.findIndex(m => m.name === message.currentModel);
                    currentModelIndex = idx >= 0 ? idx : 0;
                    // Update button label
                    if (modelSelect) {
                        const cur = models[currentModelIndex];
                        const label = (cur.provider === 'ollama' ? '🏠 ' : '') + (cur.displayName || cur.name);
                        modelSelect.firstChild.textContent = label;
                    }
                }
                break;

            case 'fileSearchResults':
                renderFileResults(message.files);
                break;

            case 'artifactCreated':
                addArtifactMessage(message.artifact);
                break;

            case 'streamChunk':
                hideTypingIndicator();
                // Don't hide activity bar, update it to show we are writing
                updateActivityBar('Writing response...');
                let lastBotMsg = [...document.querySelectorAll('.bot-message')].pop();
                if (!lastBotMsg || lastBotMsg.dataset.streaming !== 'true') {
                    lastBotMsg = addMessage('', 'bot');
                    lastBotMsg.dataset.streaming = 'true';
                    lastBotMsg.innerHTML = '';
                }

                lastBotMsg.dataset.rawText = (lastBotMsg.dataset.rawText || '') + message.text;
                lastBotMsg.innerHTML = typeof marked !== 'undefined' ? marked.parse(lastBotMsg.dataset.rawText) : lastBotMsg.dataset.rawText;

                // Throttle highlighting for performance
                if (highlightTimeout) clearTimeout(highlightTimeout);
                highlightTimeout = setTimeout(() => {
                    Prism.highlightAllUnder(lastBotMsg);
                }, 250);

                scrollToBottom();
                break;


            case 'addResponse':
                const existingStream = [...document.querySelectorAll('.bot-message')].pop();
                if (existingStream && existingStream.dataset.streaming === 'true') {
                    existingStream.dataset.streaming = 'false';
                    existingStream.dataset.rawText = message.text;
                    existingStream.innerHTML = typeof marked !== 'undefined' ? marked.parse(message.text) : message.text;
                    Prism.highlightAllUnder(existingStream);
                } else {
                    addMessage(message.text, 'bot');
                }
                setGenerating(false);
                hideActivityBar(); // Only hide when completely done
                break;

            case 'addToolCall':
                const toolDiv = document.createElement('div');
                toolDiv.className = 'tool-call tool-running';
                toolDiv.dataset.toolName = message.tool;
                toolDiv.id = message.id ? `tool-${message.id}` : `tool-${Date.now()}`;

                let toolIcon = '';
                let toolTitle = '';

                let args = message.args;
                if (args && typeof args === 'string') {
                    try {
                        args = JSON.parse(args);
                    } catch (e) {
                        // Not JSON, keep as string
                    }
                }

                // Hide noisy/internal tools
                const isInternalTool = message.tool === 'read_terminal';
                const isUnknownStatus = message.tool === 'command_status' && (
                    !args ||
                    (typeof args === 'string' && args.toLowerCase().includes('unknown')) ||
                    (typeof args === 'object' && (args.CommandId === 'unknown' || args.commandId === 'unknown'))
                );

                if (isInternalTool || isUnknownStatus) {
                    toolDiv.style.display = 'none';
                    toolDiv.classList.add('tool-hidden');
                }

                let contentHtml = '';
                if (message.args) {
                    toolDiv.dataset.args = typeof message.args === 'string' ? message.args : JSON.stringify(message.args);
                }

                // Update activity bar to show tool execution
                updateActivityBar(`Running ${message.tool}...`);


                if (message.tool === 'run_command') {
                    toolIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`;
                    const cmd = (args && (args.CommandLine || args.commandLine || args.command)) || (typeof args === 'string' ? args : 'command');
                    toolTitle = cmd;
                    contentHtml = `<div class="tool-code-block">${cmd}</div>`;
                } else if (message.tool === 'write_to_file' || message.tool === 'replace_file_content' || message.tool === 'multi_replace_file_content' || message.tool === 'write_to_file_fast') {
                    toolIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
                    const file = (args && (args.TargetFile || args.targetFile || args.file)) || (typeof args === 'string' ? args : 'file');
                    const shortName = getShortPath(file);
                    const filenameOnly = file.split(/[\\/]/).pop();
                    const badge = getFileTypeBadge(filenameOnly);
                    toolTitle = `Editing ${badge} <span class="tool-file-name">${shortName}</span>`;
                    contentHtml = `<div class="tool-file-item"><span class="file-name">${file}</span></div>`;
                    toolDiv.classList.add('tool-file-edit');
                } else if (message.tool === 'view_file') {
                    toolIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
                    const file = (args && (args.AbsolutePath || args.absolutePath || args.path || args.file)) || 'file';
                    const shortName = getShortPath(file);
                    const filenameOnly = file === 'file' ? file : file.split(/[\\/]/).pop();
                    const badge = getFileTypeBadge(filenameOnly);
                    const lines = (args && args.StartLine && args.EndLine) ? `<span class="tool-line-numbers">#L${args.StartLine}-${args.EndLine}</span>` : '';
                    toolTitle = `Analyzed ${badge} <span class="tool-file-name">${shortName}</span>${lines}`;
                    contentHtml = `<div class="tool-file-item"><span class="file-name">${file} ${lines}</span></div>`;
                } else if (message.tool === 'search_web') {
                    toolIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
                    const query = (args && args.query) || (typeof args === 'string' ? args : 'query');
                    toolTitle = `SEARCH: ${query}`;
                    contentHtml = `<div class="tool-param">${query}</div>`;
                } else if (message.tool === 'command_status') {
                    toolIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
                    const cid = (args && args.CommandId) || 'unknown';
                    toolTitle = `STATUS: ${cid}`;
                    contentHtml = `<div class="tool-param">${cid}</div>`;
                } else if (message.tool === 'find_by_name') {
                    toolIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
                    const pattern = (args && args.Pattern) || '*';
                    toolTitle = `FINDING: ${pattern}`;
                    contentHtml = `<div class="tool-param">${pattern}</div>`;
                } else if (message.tool === 'grep_search') {
                    toolIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
                    const query = (args && args.Query) || '';
                    toolTitle = `GREP: ${query}`;
                    contentHtml = `<div class="tool-param">${query}</div>`;
                } else if (message.tool === 'list_dir') {
                    toolIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
                    const dir = (args && (args.DirectoryPath || args.directoryPath || args.path || args.dir)) || 'workspace';
                    const dirname = dir === 'workspace' ? dir : dir.split(/[\\/]/).pop() || dir;
                    toolTitle = `Listing ${dirname}`;
                    contentHtml = `<div class="tool-param">${dir}</div>`;
                } else {
                    toolIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`;
                    toolTitle = message.tool.toUpperCase();
                    contentHtml = `<div class="tool-param">${args ? (typeof args === 'string' ? args : JSON.stringify(args, null, 2)) : '...'}</div>`;
                }


                toolDiv.innerHTML = `
                <div class="tool-header">
                    <div class="tool-header-info" style="flex: 1; display: flex; align-items: center; gap: 8px; overflow: hidden;">
                        ${toolIcon}
                        <span class="tool-header-title">${toolTitle}</span>
                    </div>
                    ${message.tool === 'run_command' ? `
                        <div class="tool-input-group" style="display: flex; gap: 4px; align-items: center; margin-right: 8px;">
                            <input type="text" class="tool-terminal-input" placeholder="y/n..." style="width: 50px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: white; padding: 2px 4px; font-size: 10px;">
                            <button class="tool-send-input-btn" title="Send input" style="padding: 2px 6px; font-size: 10px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer;">Send</button>
                            <button class="tool-continue-btn" title="Send Enter (Continue if stuck)" style="padding: 2px 6px; font-size: 10px; background: rgba(255,255,255,0.1); color: white; border: none; border-radius: 4px; cursor: pointer;">⏎</button>
                        </div>
                    ` : ''}
                    <span class="tool-expand-icon">›</span>
                </div>
                <div class="tool-body">
                    <div class="tool-section">${contentHtml}</div>
                </div>
            `;

                // Add terminal interaction handlers
                if (message.tool === 'run_command') {
                    const terminalInput = toolDiv.querySelector('.tool-terminal-input');
                    const sendInputBtn = toolDiv.querySelector('.tool-send-input-btn');
                    const continueBtn = toolDiv.querySelector('.tool-continue-btn');

                    const sendInput = (text) => {
                        vscode.postMessage({ type: 'sendTerminalInput', input: text });
                        if (terminalInput) terminalInput.value = '';
                    };

                    sendInputBtn?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        sendInput(terminalInput.value);
                    });

                    terminalInput?.addEventListener('keydown', (e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                            sendInput(terminalInput.value || '\n');
                        }
                    });

                    continueBtn?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        sendInput('\n');
                        continueBtn.style.opacity = '0.5';
                        setTimeout(() => { if (continueBtn) continueBtn.style.opacity = '1'; }, 500);
                    });
                }

                // Add expansion handler to the icon
                toolDiv.querySelector('.tool-expand-icon').addEventListener('click', (e) => {
                    e.stopPropagation();
                    toolDiv.classList.toggle('expanded');
                });

                // Add diff handler to the info part if it's a file edit
                if (toolDiv.classList.contains('tool-file-edit')) {
                    toolDiv.querySelector('.tool-header-info').addEventListener('click', (e) => {
                        e.stopPropagation();
                        const changeId = toolDiv.dataset.changeId;
                        if (changeId) {
                            vscode.postMessage({ type: 'requestDiff', changeId: changeId });
                        } else {
                            toolDiv.classList.toggle('expanded');
                        }
                    });
                } else if (message.tool === 'view_file') {
                    toolDiv.querySelector('.tool-header-info').addEventListener('click', (e) => {
                        e.stopPropagation();
                        const file = (args && (args.AbsolutePath || args.absolutePath || args.path || args.file));
                        if (file) {
                            vscode.postMessage({ type: 'openFile', path: file });
                        } else {
                            toolDiv.classList.toggle('expanded');
                        }
                    });
                } else {
                    // Regular tools toggle expansion on info click too
                    toolDiv.querySelector('.tool-header-info').addEventListener('click', (e) => {
                        e.stopPropagation();
                        toolDiv.classList.toggle('expanded');
                    });
                }
                messagesContainer.appendChild(toolDiv);
                scrollToBottom();
                break;

            case 'updateToolResult':
                // Try to find the tool by ID first, then fallback to last one
                let lastToolUpdate = message.id ? document.getElementById(`tool-${message.id}`) : [...document.querySelectorAll('.tool-call')].pop();

                // If it's done, it should have been updated already if we found it by ID
                if (!lastToolUpdate || lastToolUpdate.classList.contains('tool-done')) {
                    // Fallback to the very last running tool call
                    lastToolUpdate = [...document.querySelectorAll('.tool-running')].pop();
                }

                if (lastToolUpdate) {
                    lastToolUpdate.classList.remove('tool-running');
                    lastToolUpdate.classList.add('tool-done');

                    // Remove interactive inputs if they exist
                    const inputGroup = lastToolUpdate.querySelector('.tool-input-group');
                    if (inputGroup) inputGroup.remove();

                    const header = lastToolUpdate.querySelector('.tool-header');
                    const toolName = lastToolUpdate.dataset.toolName;

                    let completionTitle = '';
                    // Simple checkmark
                    let completionIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

                    // Parse the result to check for errors or background status
                    let resultObj = {};
                    let isError = false;
                    let isBackgroundProcess = false;
                    let cleanResult = message.result;

                    if (typeof cleanResult === 'string') {
                        try {
                            resultObj = JSON.parse(cleanResult);
                        } catch (e) {
                            // Plain string result
                        }
                    } else if (typeof cleanResult === 'object' && cleanResult !== null) {
                        resultObj = cleanResult;
                    }

                    // Check failure conditions first
                    if (resultObj.error || (resultObj.exitCode && resultObj.exitCode !== 0)) {
                        isError = true;
                    }

                    // Check background status
                    if (resultObj.id && resultObj.status === 'running') {
                        isBackgroundProcess = true;
                        completionTitle = 'PROCESS RUNNING...';
                        cleanResult = '✓ Process started in background (ID: ' + resultObj.id.substring(0, 8) + '...)';
                        completionIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4facfe" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
                    } else if (isError) {
                        completionTitle = 'COMMAND FAILED';
                        completionIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f44336" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
                    } else {
                        // Success cases
                        if (toolName === 'run_command') {
                            completionTitle = 'COMMAND COMPLETED';
                        } else if (toolName === 'write_to_file' || toolName === 'replace_file_content' || toolName === 'multi_replace_file_content') {
                            completionTitle = 'FILE UPDATED';
                        } else if (toolName === 'search_web') {
                            completionTitle = 'SEARCH COMPLETED';
                        } else {
                            completionTitle = 'COMPLETED';
                        }
                    }

                    if (header) {
                        const statusColor = isError ? '#f44336' : isBackgroundProcess ? '#4facfe' : '#4caf50';
                        const titleSpan = header.querySelector('.tool-header-title');

                        // Keep the original description but add a status wrapper if needed
                        if (titleSpan) {
                            titleSpan.style.color = statusColor;
                        }

                        // Replace only the icon part, unless it's a file tool (we want to keep the document icon)
                        const isFileTool = toolName === 'write_to_file' || toolName === 'replace_file_content' || toolName === 'multi_replace_file_content' || toolName === 'view_file' || toolName === 'write_to_file_fast';
                        if (!isFileTool) {
                            const oldIcon = header.querySelector('.tool-header-info svg');
                            if (oldIcon) {
                                oldIcon.outerHTML = completionIcon;
                            }
                        }
                    }

                    // Prepare display text
                    if (typeof cleanResult === 'string') {
                        // already string
                    } else {
                        if (resultObj.stdout || resultObj.stderr) {
                            cleanResult = (resultObj.stdout || '') + (resultObj.stderr ? '\n' + resultObj.stderr : '');
                            if (!cleanResult.trim()) cleanResult = isError ? resultObj.error || 'Command failed' : '(Command executed successfully)';
                        } else if (resultObj.output) {
                            cleanResult = resultObj.output;
                        } else if (resultObj.message) {
                            cleanResult = resultObj.message;
                        } else {
                            cleanResult = JSON.stringify(resultObj, null, 2);
                        }
                    }

                    let resultText = typeof cleanResult === 'string' ? cleanResult : JSON.stringify(cleanResult, null, 2);
                    resultText = stripAnsi(resultText);

                    if (toolName === 'write_to_file' || toolName === 'replace_file_content' || toolName === 'multi_replace_file_content' || toolName === 'write_to_file_fast') {
                        // Redundant badge removed as header now updates with stats
                        const toolSection = lastToolUpdate.querySelector('.tool-section');
                        if (toolSection) {
                            toolSection.style.opacity = '0.8';
                        }
                    }

                    const toolBody = lastToolUpdate.querySelector('.tool-body');
                    if (toolBody) {
                        const resultDiv = document.createElement('div');
                        resultDiv.className = 'tool-result';

                        if (isBackgroundProcess) {
                            resultDiv.innerHTML = `
                                <div class="tool-result-content" style="color: #4facfe; font-weight: 600; padding: 10px 12px;">${resultText}</div>
                            `;
                            toolBody.appendChild(resultDiv);
                        } else {
                            // General results (like searching web or command outputs)
                            resultDiv.innerHTML = `
                                <div class="tool-result-header">RESULT</div>
                                <div class="tool-result-content">${resultText}</div>
                            `;
                            toolBody.appendChild(resultDiv);
                        }
                    }

                    scrollToBottom();
                }
                break;

            case 'toolStats':
                const statsDiv = document.createElement('div');
                statsDiv.className = 'tool-stats';
                statsDiv.innerHTML = `
                <span class="tool-stats-icon">📊</span>
                <span>Executed ${message.count} tools in ${message.duration}ms (${message.success} succeeded, ${message.failed} failed)</span>
            `;
                messagesContainer.appendChild(statsDiv);
                scrollToBottom();
                break;

            case 'toolError':
                showToolError(message.tool, message.error);
                break;

            case 'toolOutput':
                const outputTool = document.getElementById(`tool-${message.id}`);
                if (outputTool) {
                    let outputContent = outputTool.querySelector('.tool-output-content');
                    if (!outputContent) {
                        const body = outputTool.querySelector('.tool-body');
                        const outputDiv = document.createElement('div');
                        outputDiv.className = 'tool-result tool-live-output';
                        outputDiv.innerHTML = `
                            <div class="tool-result-header">STDOUT/STDERR</div>
                            <div class="tool-result-content tool-output-content" style="white-space: pre-wrap; font-family: var(--vscode-font-monospace); font-size: 11px; max-height: 200px; overflow-y: auto;"></div>
                        `;
                        body.appendChild(outputDiv);
                        outputContent = outputDiv.querySelector('.tool-output-content');
                        outputTool.classList.add('expanded'); // Auto-expand when output starts
                    }
                    const cleanOutput = stripAnsi(message.output);
                    outputContent.textContent += cleanOutput;
                    outputContent.scrollTop = outputContent.scrollHeight;
                }
                break;

            case 'budgetUpdate':
                updateBudgetIndicator(message.budget);
                break;

            case 'clearChat':
                messagesContainer.innerHTML = '';
                break;

            case 'loadHistory':
                messagesContainer.innerHTML = '';
                message.history.forEach(turn => {
                    const role = turn.role === 'model' || turn.role === 'assistant' ? 'bot' : 'user';

                    if (turn.role === 'function' || turn.role === 'tool') {
                        // Render tool result
                        const resultPart = turn.parts[0]?.functionResponse;
                        if (resultPart) {
                            // SKIP results for hidden tools
                            const toolName = resultPart.name;
                            const isInternal = toolName === 'read_terminal';
                            const isUnknown = toolName === 'command_status' && (!resultPart.response || JSON.stringify(resultPart.response).toLowerCase().includes('unknown'));
                            if (isInternal || isUnknown) return;

                            const resultDiv = document.createElement('div');
                            resultDiv.className = 'tool-result';
                            let resultText = typeof resultPart.response === 'string' ? resultPart.response : JSON.stringify(resultPart.response, null, 2);
                            resultText = stripAnsi(resultText);
                            resultDiv.innerHTML = `
                                <div class="tool-result-header">RESULT</div>
                                <div class="tool-result-content">${resultText}</div>
                            `;

                            messagesContainer.appendChild(resultDiv);
                        }
                        return;
                    }


                    turn.parts.forEach(part => {
                        if (part.text) {
                            addMessage(part.text, role);
                        } else if (part.functionCall) {
                            const toolName = part.functionCall.name;
                            let args = part.functionCall.args;
                            if (args && typeof args === 'string') {
                                try { args = JSON.parse(args); } catch (e) { }
                            }

                            // SKIP hidden tools in history
                            const isInternal = toolName === 'read_terminal';
                            const isUnknown = toolName === 'command_status' && (
                                !args ||
                                (typeof args === 'string' && args.toLowerCase().includes('unknown')) ||
                                (typeof args === 'object' && (args.CommandId === 'unknown' || args.commandId === 'unknown'))
                            );

                            if (isInternal || isUnknown) return;

                            // We don't have a perfect addToolCallUI that doesn't trigger side effects,
                            // so for history we'll just show a text representation of the tool call
                            const argsText = stripAnsi(typeof part.functionCall.args === 'string' ? part.functionCall.args : JSON.stringify(part.functionCall.args));

                            const toolDiv = document.createElement('div');
                            toolDiv.className = 'tool-call tool-done';
                            toolDiv.innerHTML = `
                                <div class="tool-header">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>
                                    <span>${toolName.toUpperCase()}</span>
                                </div>
                                <div class="tool-section"><div class="tool-param">${argsText}</div></div>
                            `;
                            messagesContainer.appendChild(toolDiv);
                        }
                    });
                });

                // Update history count
                const historyCount = document.getElementById('history-count');
                if (historyCount) {
                    const messageCount = message.history.length;
                    historyCount.textContent = `${messageCount} message${messageCount !== 1 ? 's' : ''}`;
                }
                break;

            case 'addAttachment':
                addAttachment(message.name, message.path, message.icon);
                break;

            case 'triggerMention':
                if (chatInput) {
                    const currentVal = chatInput.value;
                    chatInput.value = currentVal.endsWith(' ') || currentVal === '' ? currentVal + '@' : currentVal + ' @';
                    chatInput.focus();
                    renderMentions(''); // Show the dropdown
                }
                break;

            case 'triggerWorkflow':
                if (chatInput) {
                    const currentVal = chatInput.value;
                    chatInput.value = currentVal.endsWith(' ') || currentVal === '' ? currentVal + '/' : currentVal + ' /';
                    chatInput.focus();
                }
                break;

            case 'conversationsList':
                const panel = document.getElementById('conversations-panel');
                if (panel || message.forceShow) {
                    showConversationsPanel(message.conversations, message.currentId, true);
                }
                break;



            case 'pendingChangesList':
                showBatchReviewPanel(message.changes);
                break;

            case 'addFileChange':
                addFileChangeCard(message.change);
                // Update the last file tool call header
                const lastFileTool = [...document.querySelectorAll('.tool-file-edit')].pop();
                if (lastFileTool) {
                    lastFileTool.dataset.changeId = message.change.id;
                    const titleSpan = lastFileTool.querySelector('.tool-header-title');
                    if (titleSpan) {
                        const filename = message.change.filename.split(/[\\/]/).pop();
                        const badge = getFileTypeBadge(filename);
                        const stats = `<span class="tool-stats-lines"><span class="stats-added">+${message.change.linesAdded}</span> <span class="stats-removed">-${message.change.linesRemoved}</span></span>`;
                        titleSpan.innerHTML = `Edited ${badge} <span class="tool-file-name">${filename}</span> ${stats}`;
                    }
                }
                break;


            case 'updateFileChangesCount':
                updateFileChangesCountDisplay(message.count, message.total);
                break;

            case 'fileChangeUpdated':
                updateFileChangeCard(message.change);
                break;

            case 'showDiff':
                showDiffViewer(message.change);
                break;

            case 'breakingChangesDetected':
                showBreakingChangesWarning(message.filename, message.changes, message.message);
                break;

            case 'contextGathered':
                showContextGatheredNotification(message);
                break;

            case 'commandApprovalRequest':
                showCommandApproval(message);
                break;
            case 'commandApprovalUpdate':
                const actionsContainer = document.getElementById(`actions-${message.id}`);
                if (actionsContainer) {
                    actionsContainer.innerHTML = message.status === 'approved'
                        ? '<span style="color: #4caf50; font-size: 11px; font-weight: 600;">✓ APPROVED</span>'
                        : '<span style="color: #f44336; font-size: 11px; font-weight: 600;">✕ REJECTED</span>';
                }
                break;


        }
    });

    function showConversationsPanel(conversations, currentId, isRefresh = false) {
        // Remove existing panel if any
        const existing = document.getElementById('conversations-panel');
        if (existing) {
            existing.remove();
            if (!isRefresh) return; // Toggle off if not a refresh
        }


        const panel = document.createElement('div');
        panel.id = 'conversations-panel';
        panel.className = 'conversations-panel';

        let html = `
            <div class="conversations-header">
                <h3>Conversations</h3>
                <button class="close-btn" onclick="document.getElementById('conversations-panel').remove()">×</button>
            </div>
            <div class="conversations-list">
        `;

        if (conversations.length === 0) {
            html += '<div class="no-conversations">No conversations yet</div>';
        } else {
            conversations.forEach(conv => {
                const isActive = conv.id === currentId;
                const date = new Date(conv.timestamp);
                const timeAgo = getTimeAgo(date);

                html += `
                    <div class="conversation-item ${isActive ? 'active' : ''}" data-id="${conv.id}">
                        <div class="conversation-info">
                            <div class="conversation-title">${conv.title}</div>
                            <div class="conversation-time">${timeAgo}</div>
                        </div>
                        <button class="delete-conv-btn" title="Delete conversation" data-id="${conv.id}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                `;

            });
        }

        html += '</div>';
        panel.innerHTML = html;
        document.body.appendChild(panel);

        // Use event delegation for better reliability
        const listContainer = panel.querySelector('.conversations-list');
        listContainer?.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-conv-btn');
            const item = e.target.closest('.conversation-item');

            if (deleteBtn) {
                e.preventDefault();
                e.stopPropagation();
                const convId = deleteBtn.dataset.id;
                // Confirmation will happen on the host side for better reliability
                vscode.postMessage({ type: 'deleteConversation', conversationId: convId });
                return;
            }


            if (item) {
                const convId = item.dataset.id;
                vscode.postMessage({ type: 'switchConversation', conversationId: convId });
                panel.remove();
            }
        });
    }



    function getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        const intervals = {
            year: 31536000,
            month: 2592000,
            week: 604800,
            day: 86400,
            hour: 3600,
            minute: 60
        };

        for (const [name, secondsInInterval] of Object.entries(intervals)) {
            const interval = Math.floor(seconds / secondsInInterval);
            if (interval >= 1) {
                return interval === 1 ? `1 ${name} ago` : `${interval} ${name}s ago`;
            }
        }
        return 'just now';
    }

    // File Change Tracking Functions
    function addFileChangeCard(change) {
        const card = document.createElement('div');
        card.className = 'file-change-card';
        card.dataset.changeId = change.id;
        card.dataset.status = change.status;

        const statusBadge = change.operation === 'create' ? 'Created' : 'Edited';
        const statusClass = change.operation === 'create' ? 'status-created' : 'status-edited';
        const lineChanges = `+${change.linesAdded} -${change.linesRemoved}`;

        const filePath = change.filename;
        const fileParts = filePath.split(/[\\/]/);
        const folderName = fileParts.length > 1 ? fileParts[fileParts.length - 2] : '';
        const fileName = fileParts[fileParts.length - 1];
        const displayPath = folderName ? `${folderName}${filePath.includes('\\') ? '\\' : '/'}${fileName}` : fileName;

        const isApproved = change.status === 'approved';
        const isRejected = change.status === 'rejected';

        card.innerHTML = `
            <div class="file-change-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                </svg>
                <span class="file-change-status ${statusClass}">${statusBadge}</span>
                <span class="file-change-name" title="${filePath}">${displayPath}</span>
                <span class="file-change-lines">${lineChanges}</span>
                ${isApproved ? '<span class="status-approved-label">✓ Approved</span>' :
                isRejected ? '<span class="status-rejected-label">✕ Rejected</span>' :
                    `<button class="file-change-diff-btn" data-change-id="${change.id}">Open diff</button>`}
            </div>
            ${change.description ? `<div class="file-change-description">${change.description}</div>` : ''}
        `;

        messagesContainer.appendChild(card);

        // Add click handler for diff button
        const diffBtn = card.querySelector('.file-change-diff-btn');
        diffBtn?.addEventListener('click', () => {
            vscode.postMessage({ type: 'requestDiff', changeId: change.id });
        });

        scrollToBottom();
    }

    function updateFileChangesCountDisplay(count, total) {
        const filesWithChangesBtn = document.getElementById('files-with-changes');
        if (filesWithChangesBtn) {
            filesWithChangesBtn.innerHTML = `
                <div class="files-with-changes-content">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                        <polyline points="13 2 13 9 20 9"></polyline>
                    </svg>
                    <span>${count} Files With Changes</span>
                </div>
                ${count > 0 ? '<button id="review-all-btn" class="review-btn">Review</button>' : ''}
            `;

            const reviewBtn = document.getElementById('review-all-btn');
            reviewBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'getPendingChanges' });
            });
        }
    }

    function showBatchReviewPanel(changes) {
        const panel = document.createElement('div');
        panel.id = 'batch-review-panel';
        panel.className = 'modal-overlay';

        const pendingChanges = changes.filter(c => c.status === 'pending');

        panel.innerHTML = `
            <div class="modal-content review-panel-content">
                <div class="modal-header">
                    <h2>Review Pending Changes</h2>
                    <button class="modal-close-btn">&times;</button>
                </div>
                <div class="review-panel-body">
                    <div class="review-panel-actions">
                        <button class="approve-all-btn">Approve All (${pendingChanges.length})</button>
                        <button class="reject-all-btn">Reject All</button>
                    </div>
                    <div class="changes-list">
                        ${pendingChanges.map(change => `
                            <div class="review-change-item" data-id="${change.id}">
                                <div class="review-change-info">
                                    <span class="change-filename">${change.filename}</span>
                                    <span class="change-stats">+${change.linesAdded} -${change.linesRemoved}</span>
                                </div>
                                <div class="review-change-btns">
                                    <button class="review-diff-btn" data-id="${change.id}">View Diff</button>
                                    <button class="review-approve-btn" data-id="${change.id}">Approve</button>
                                    <button class="review-reject-btn" data-id="${change.id}">Reject</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        // Add event listeners
        panel.querySelector('.modal-close-btn')?.addEventListener('click', () => panel.remove());
        panel.querySelector('.approve-all-btn')?.addEventListener('click', () => {
            vscode.postMessage({ type: 'approveAllChanges' });
            panel.remove();
        });
        panel.querySelector('.reject-all-btn')?.addEventListener('click', () => {
            vscode.postMessage({ type: 'rejectAllChanges' });
            panel.remove();
        });

        panel.querySelectorAll('.review-diff-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                vscode.postMessage({ type: 'requestDiff', changeId: btn.dataset.id });
            });
        });

        panel.querySelectorAll('.review-approve-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                vscode.postMessage({ type: 'approveChange', changeId: btn.dataset.id });
                btn.closest('.review-change-item')?.remove();
                if (panel.querySelectorAll('.review-change-item').length === 0) panel.remove();
            });
        });

        panel.querySelectorAll('.review-reject-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                vscode.postMessage({ type: 'rejectChange', changeId: btn.dataset.id });
                btn.closest('.review-change-item')?.remove();
                if (panel.querySelectorAll('.review-change-item').length === 0) panel.remove();
            });
        });
    }

    function updateFileChangeCard(change) {
        const card = document.querySelector(`[data-change-id="${change.id}"]`);
        if (card) {
            card.dataset.status = change.status;
            const header = card.querySelector('.file-change-header');
            if (header) {
                const diffBtn = header.querySelector('.file-change-diff-btn');
                if (change.status === 'approved') {
                    card.classList.add('approved');
                    if (diffBtn) diffBtn.outerHTML = '<span class="status-approved-label">✓ Approved</span>';
                } else if (change.status === 'rejected') {
                    card.classList.add('rejected');
                    if (diffBtn) diffBtn.outerHTML = '<span class="status-rejected-label">✕ Rejected</span>';
                }
            }
        }
    }

    function showDiffViewer(change) {
        // Remove existing diff viewer if any
        const existing = document.getElementById('diff-viewer');
        if (existing) {
            existing.remove();
        }

        const viewer = document.createElement('div');
        viewer.id = 'diff-viewer';
        viewer.className = 'diff-viewer-modal';

        const shortName = getShortPath(change.filename);

        viewer.innerHTML = `
            <div class="diff-viewer-content">
                <div class="diff-viewer-header">
                    <h3>${shortName}</h3>
                    <button class="diff-viewer-close">×</button>
                </div>
                <div class="diff-viewer-body">
                    <div class="diff-info">
                        <span class="diff-operation">${change.operation === 'create' ? 'Created' : 'Edited'}</span>
                        <span class="diff-lines">+${change.linesAdded} -${change.linesRemoved}</span>
                    </div>
                    ${change.description ? `<div class="diff-description">${change.description}</div>` : ''}
                    <div class="diff-content">
                        <pre class="language-diff"><code id="diff-code-block">${change.diff ? change.diff.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Diff preview not available.'}</code></pre>
                    </div>
                </div>
                <div class="diff-viewer-footer">
                    <button class="diff-approve-btn" data-change-id="${change.id}">✓ Approve</button>
                    <button class="diff-reject-btn" data-change-id="${change.id}">✗ Reject</button>
                </div>
            </div>
        `;

        document.body.appendChild(viewer);

        // Run Prism highlighting
        const codeBlock = viewer.querySelector('#diff-code-block');
        if (codeBlock && typeof Prism !== 'undefined') {
            Prism.highlightElement(codeBlock);
        }

        // Add event listeners
        viewer.querySelector('.diff-viewer-close')?.addEventListener('click', () => {
            viewer.remove();
        });

        viewer.querySelector('.diff-approve-btn')?.addEventListener('click', () => {
            vscode.postMessage({ type: 'approveChange', changeId: change.id });
            viewer.remove();
        });

        viewer.querySelector('.diff-reject-btn')?.addEventListener('click', () => {
            vscode.postMessage({ type: 'rejectChange', changeId: change.id });
            viewer.remove();
        });

        // Close on background click
        viewer.addEventListener('click', (e) => {
            if (e.target === viewer) {
                viewer.remove();
            }
        });
    }


    // Event Listeners
    document.getElementById('clear-history')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'clearChat' });
    });

    document.getElementById('open-settings')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'openSettings' });
    });

    document.getElementById('chat-history-btn')?.addEventListener('click', () => {
        // Request conversations list from extension
        vscode.postMessage({ type: 'getConversations' });
    });

    document.getElementById('new-chat-btn')?.addEventListener('click', () => {
        // Start a new conversation
        vscode.postMessage({ type: 'newConversation' });
    });

    const moreOptionsBtn = document.getElementById('more-options-btn');
    const moreOptionsDropdown = document.createElement('div');
    moreOptionsDropdown.className = 'add-dropdown'; // Reuse styles
    moreOptionsDropdown.id = 'more-options-dropdown';
    document.body.appendChild(moreOptionsDropdown);

    moreOptionsBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        moreOptionsDropdown.innerHTML = `
            <div class="add-dropdown-header">Options</div>
            <div class="add-dropdown-item" id="clear-chat-option">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Clear Current Chat</span>
            </div>
            <div class="add-dropdown-item" id="settings-option">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                <span>Settings</span>
            </div>
        `;

        // Position dropdown
        const rect = moreOptionsBtn.getBoundingClientRect();
        moreOptionsDropdown.style.top = (rect.bottom + 5) + 'px';
        moreOptionsDropdown.style.right = '10px';
        moreOptionsDropdown.style.left = 'auto';
        moreOptionsDropdown.classList.toggle('show');

        // Add handlers for dropdown items
        document.getElementById('clear-chat-option')?.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear the current chat history?')) {
                vscode.postMessage({ type: 'newConversation' });
            }
            moreOptionsDropdown.classList.remove('show');
        });

        document.getElementById('settings-option')?.addEventListener('click', () => {
            vscode.postMessage({ type: 'openSettings' });
            moreOptionsDropdown.classList.remove('show');
        });
    });


    modelSelect?.addEventListener('change', (e) => {
        vscode.postMessage({ type: 'changeModel', model: e.target.value });
    });

    document.addEventListener('click', e => {
        if (e.target.classList.contains('apply-btn')) {
            const code = decodeURIComponent(e.target.dataset.code);
            vscode.postMessage({ type: 'sendMessage', text: `Apply this code change:\n\`\`\`\n${code}\n\`\`\`` });
        }
        if (e.target.classList.contains('copy-btn')) {
            const code = decodeURIComponent(e.target.dataset.code);
            navigator.clipboard.writeText(code).then(() => {
                e.target.innerText = 'Copied!';
                setTimeout(() => {
                    e.target.innerText = 'Copy';
                }, 2000);
            });
        }
        if (e.target.classList.contains('file-link')) {
            const path = e.target.dataset.path;
            vscode.postMessage({ type: 'openFile', path });
        }
    });

    function sendMessage() {
        const text = chatInput.value.trim();
        console.log('sendMessage called, text:', text);
        if (text || attachments.length > 0) {
            const mode = modes[currentModeIndex].name;
            const model = models[currentModelIndex].name;
            console.log(`Sending message using mode=${mode}, model=${model}`);

            vscode.postMessage({
                type: 'sendMessage',
                text,
                mode,
                model,
                attachments: attachments
            });
            setGenerating(true);
            updateActivityBar('Thinking...');
            chatInput.value = '';
            chatInput.style.height = 'auto';

            // Clear attachments
            attachments = [];
            renderAttachments();

            toggleSendButton();
        } else {
            console.log('Message is empty, not sending');
        }
    }

    const mentionDropdown = document.getElementById('mention-dropdown');
    const mentionItems = [
        { id: 'context', text: 'Code Context Items', icon: '</>', description: 'Active file, selection, and tabs' },
        { id: 'files', text: 'Files', icon: '📄', description: 'Search and link workspace files' },
        { id: 'dirs', text: 'Directories', icon: '📁', description: 'Reference workspace folders' },
        //{ id: 'mcp', text: 'MCP servers', icon: '🔨', description: 'Access external MCP tools' },
        { id: 'rules', text: 'Rules', icon: '📋', description: 'Project conventions and guidelines' },
        { id: 'conversations', text: 'Conversations', icon: '💬', description: 'Search chat history' },
        { id: 'terminal', text: 'Terminal', icon: '💻', description: 'Active terminal buffer' }
    ];

    let selectedIndex = 0;

    let searchTimeout;
    function searchFilesDebounced(query) {
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            vscode.postMessage({ type: 'searchFiles', query });
        }, 300);
    }

    function renderFileResults(files) {
        if (!files || files.length === 0) {
            mentionDropdown.innerHTML = `<div class="mention-item" style="cursor: default; color: var(--text-dim);">No files found</div>`;
            mentionDropdown.style.display = 'block';
            return;
        }

        mentionDropdown.style.display = 'block';
        mentionDropdown.innerHTML = files.map((file, index) => `
            <div class="mention-item ${index === 0 ? 'selected' : ''}" data-text="@${file.label}" data-type="file">
                <div class="mention-icon">📄</div>
                <div class="mention-content">
                    <div class="mention-text">${file.label}</div>
                    <div class="mention-desc">${file.description}</div>
                </div>
            </div>
        `).join('');

        mentionDropdown.style.bottom = (chatInput.offsetHeight + 10) + 'px';

        mentionDropdown.querySelectorAll('.mention-item').forEach((item, index) => {
            item.addEventListener('click', () => {
                selectMention(item.dataset.text);
            });
        });

        selectedIndex = 0;
    }

    function renderMentions(filter = '') {
        if (filter.startsWith('files ')) {
            const query = filter.substring(6);
            mentionDropdown.innerHTML = `<div class="mention-item" style="cursor: default; color: var(--text-dim);">Searching files...</div>`;
            mentionDropdown.style.display = 'block';
            mentionDropdown.style.bottom = (chatInput.offsetHeight + 10) + 'px';
            searchFilesDebounced(query);
            return;
        }

        const filtered = mentionItems.filter(item =>
            item.text.toLowerCase().includes(filter.toLowerCase()) ||
            item.id.toLowerCase().includes(filter.toLowerCase())
        );

        if (filtered.length === 0) {
            mentionDropdown.style.display = 'none';
            return;
        }

        mentionDropdown.style.display = 'block';
        mentionDropdown.innerHTML = filtered.map((item, index) => `
            <div class="mention-item ${index === selectedIndex ? 'selected' : ''}" data-text="@${item.id}">
                <div class="mention-icon">${item.icon}</div>
                <div class="mention-content">
                    <div class="mention-text">${item.text}</div>
                    <div class="mention-desc">${item.description}</div>
                </div>
            </div>
        `).join('');

        // Position dropdown
        mentionDropdown.style.bottom = (chatInput.offsetHeight + 10) + 'px';

        mentionDropdown.querySelectorAll('.mention-item').forEach((item, index) => {
            item.addEventListener('click', () => {
                selectMention(item.dataset.text);
            });
        });
    }

    function selectMention(text) {
        const value = chatInput.value;
        const lastAtIndex = value.lastIndexOf('@');

        if (text === '@files') {
            chatInput.value = value.substring(0, lastAtIndex) + '@files ';
            chatInput.focus();
            renderMentions('files ');
            return;
        }

        chatInput.value = value.substring(0, lastAtIndex) + text + ' ';
        mentionDropdown.style.display = 'none';
        chatInput.focus();
    }

    chatInput.addEventListener('input', (e) => {
        const value = chatInput.value;
        const cursorPosition = chatInput.selectionStart;

        // Auto-expand textarea
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
        toggleSendButton();

        // Check for @ mention trigger
        const lastAtIndex = value.lastIndexOf('@', cursorPosition - 1);
        if (lastAtIndex !== -1) {
            // Check if it's a valid trigger (start of line or preceded by space)
            const isStart = lastAtIndex === 0;
            const isPrecededBySpace = isStart || value[lastAtIndex - 1] === ' ' || value[lastAtIndex - 1] === '\n';

            if (isPrecededBySpace) {
                const textAfterAt = value.substring(lastAtIndex + 1, cursorPosition);
                // Only show if no spaces in the filter text
                if (!textAfterAt.includes(' ')) {
                    renderMentions(textAfterAt);
                    // Position dropdown near the input
                    mentionDropdown.style.bottom = (chatInput.offsetHeight + 10) + 'px';
                    return;
                }
            }
        }

        mentionDropdown.style.display = 'none';
    });

    chatInput.addEventListener('keydown', (e) => {
        if (mentionDropdown.style.display === 'block') {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const items = mentionDropdown.querySelectorAll('.mention-item');
                selectedIndex = (selectedIndex + 1) % items.length;
                renderMentions(chatInput.value.substring(chatInput.value.lastIndexOf('@') + 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const items = mentionDropdown.querySelectorAll('.mention-item');
                selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                renderMentions(chatInput.value.substring(chatInput.value.lastIndexOf('@') + 1));
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const selected = mentionDropdown.querySelector('.mention-item.selected');
                if (selected) {
                    selectMention(selected.dataset.text);
                }
            } else if (e.key === 'Escape') {
                mentionDropdown.style.display = 'none';
            }
            return;
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            console.log('Enter key pressed, sending message...');
            e.preventDefault();
            sendMessage();
        }
    });

    // Mode selector dropdown
    if (modeSelect) {
        const modeDropdown = document.createElement('div');
        modeDropdown.className = 'dropdown-menu';
        modeSelect.appendChild(modeDropdown);

        function renderModeDropdown() {
            const otherModes = modes.filter((_, index) => index !== currentModeIndex);

            modeDropdown.innerHTML = `
                <div class="dropdown-header">Mode</div>
                ${otherModes.map((mode, index) => {
                const actualIndex = modes.findIndex(m => m.name === mode.name);
                return `<div class="dropdown-item" data-index="${actualIndex}">${mode.name}</div>`;
            }).join('')}
                <div class="dropdown-separator"></div>
                <div class="dropdown-current">${modes[currentModeIndex].name}</div>
            `;

            modeDropdown.querySelectorAll('.dropdown-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    currentModeIndex = parseInt(item.dataset.index);
                    modeSelect.childNodes[0].textContent = modes[currentModeIndex].name;
                    modeDropdown.classList.remove('show');
                    vscode.postMessage({ type: 'changeMode', mode: modes[currentModeIndex].name });
                });
            });
        }

        modeSelect.addEventListener('click', (e) => {
            e.stopPropagation();
            renderModeDropdown();
            modeDropdown.classList.toggle('show');
            // Close model dropdown if open
            if (modelSelect) {
                const modelDropdown = modelSelect.querySelector('.dropdown-menu');
                if (modelDropdown) modelDropdown.classList.remove('show');
            }
        });
    }

    // Model selector dropdown
    if (modelSelect) {
        const modelDropdown = document.createElement('div');
        modelDropdown.className = 'dropdown-menu';
        modelSelect.appendChild(modelDropdown);

        function renderModelDropdown() {
            const cur = models[currentModelIndex] || models[0];
            if (!cur) { return; }

            // Group models by provider
            const localModels  = models.filter(m => m.provider === 'ollama');
            const cloudModels  = models.filter(m => m.provider !== 'ollama');

            function makeRow(model) {
                const idx   = models.indexOf(model);
                const icon  = model.provider === 'ollama' ? '🏠 ' : '';
                const label = icon + (model.displayName || model.name);
                const isCur = idx === currentModelIndex;
                return '<div class="dropdown-item' + (isCur ? ' selected' : '') + '" data-index="' + idx + '">' + label + '</div>';
            }

            let html = '<div class="dropdown-header">Model</div>';

            if (cloudModels.length > 0) {
                html += '<div class="dropdown-group-label" style="padding:4px 12px;font-size:10px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.06em;margin-top:4px">☁ Cloud</div>';
                html += cloudModels.map(makeRow).join('');
            }

            if (localModels.length > 0) {
                html += '<div class="dropdown-group-label" style="padding:4px 12px;font-size:10px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.06em;margin-top:4px">🏠 Local (Ollama)</div>';
                html += localModels.map(makeRow).join('');
            }

            if (localModels.length === 0) {
                html += '<div style="padding:6px 12px;font-size:11px;color:var(--vscode-descriptionForeground);opacity:.7">' +
                        'No local models — start Ollama &amp; run: <code style="font-family:monospace">ollama pull llama3.2</code></div>';
            }

            if (cloudModels.length === 0 && localModels.length === 0) {
                html = '<div class="dropdown-header">No Models Configured</div>' +
                       '<div style="padding:8px 12px;font-size:11px;color:var(--vscode-descriptionForeground)">' +
                       'Set an API key in Settings (⚙) or start Ollama for local models.</div>';
            }

            html += '<div class="dropdown-separator"></div>';
            const curLabel = (cur.provider === 'ollama' ? '🏠 ' : '') + (cur.displayName || cur.name);
            html += '<div class="dropdown-current">' + curLabel + '</div>';

            modelDropdown.innerHTML = html;

            modelDropdown.querySelectorAll('.dropdown-item').forEach(item => {
                item.addEventListener('click', e => {
                    e.stopPropagation();
                    currentModelIndex = parseInt(item.dataset.index);
                    const sel = models[currentModelIndex];
                    if (modelSelect && modelSelect.firstChild) {
                        modelSelect.firstChild.textContent = (sel.provider === 'ollama' ? '🏠 ' : '') + (sel.displayName || sel.name);
                    }
                    modelDropdown.classList.remove('show');
                    vscode.postMessage({ type: 'changeModel', model: sel.name, provider: sel.provider });
                });
            });
        }

        modelSelect.addEventListener('click', (e) => {
            e.stopPropagation();
            renderModelDropdown();
            modelDropdown.classList.toggle('show');
            // Close mode dropdown if open
            if (modeSelect) {
                const modeDropdown = modeSelect.querySelector('.dropdown-menu');
                if (modeDropdown) modeDropdown.classList.remove('show');
            }
        });
    }

    // Close dropdowns when clicking outside
    document.addEventListener('click', () => {
        document.querySelectorAll('.dropdown-menu, .add-dropdown').forEach(dropdown => {
            dropdown.classList.remove('show');
        });
    });

    // Microphone and Speech Recognition logic
    let recognition = null;
    let isRecording = false;

    if ('webkitSpeechRecognition' in window) {
        recognition = new webkitSpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isRecording = true;
            micButton.classList.add('recording');
            chatInput.placeholder = 'Listening...';
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            chatInput.value = transcript;
            chatInput.focus();
            toggleSendButton();
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            stopRecording();
            let errorMessage = `Microphone Error (${event.error}): `;

            if (event.error === 'not-allowed') {
                errorMessage += 'Access denied. Please check your Windows Privacy Settings and VS Code permissions.';
            } else if (event.error === 'service-not-allowed') {
                errorMessage += 'Speech service is not allowed or available in this environment.';
            } else {
                errorMessage += 'Something went wrong with the speech recognition service.';
            }

            vscode.postMessage({
                type: 'error',
                text: errorMessage
            });
        };

        recognition.onend = () => {
            stopRecording();
        };
    }

    function stopRecording() {
        isRecording = false;
        if (micButton) micButton.classList.remove('recording');
        if (chatInput) chatInput.placeholder = 'Ask anything (Ctrl+L), @ to mention, / for workflows';
    }

    function toggleRecording() {
        if (!recognition) {
            vscode.postMessage({
                type: 'error',
                text: 'Speech recognition is not supported in this environment. Please ensure you are using a standard VS Code installation.'
            });
            return;
        }

        if (isRecording) {
            recognition.stop();
        } else {
            try {
                console.log('Attempting to start speech recognition...');
                recognition.start();
            } catch (err) {
                console.error('Speech recognition start error:', err);
                vscode.postMessage({
                    type: 'error',
                    text: 'Could not start speech recognition: ' + err.message
                });
            }
        }
    }

    // Microphone button click handler
    if (micButton) {
        micButton.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleRecording();
        });
    }

    // Send button click handler
    if (sendButton) {
        sendButton.addEventListener('click', () => {
            console.log('Send button clicked');
            sendMessage();
        });
    }

    // Stop button click handler
    if (stopButton) {
        stopButton.addEventListener('click', () => {
            vscode.postMessage({ type: 'stopGeneration' });
        });
    }

    // Continue button click handler
    if (continueButton) {
        continueButton.addEventListener('click', () => {
            vscode.postMessage({ type: 'continueGeneration' });
            updateActivityBar('Thinking...');
        });
    }

    const addDropdown = document.getElementById('add-dropdown');

    // Add button click handler
    if (addButton && addDropdown) {
        addButton.addEventListener('click', (e) => {
            e.stopPropagation();
            addDropdown.classList.toggle('show');
            // Close other dropdowns
            if (modelSelect) modelSelect.querySelector('.dropdown-menu')?.classList.remove('show');
            if (modeSelect) modeSelect.querySelector('.dropdown-menu')?.classList.remove('show');
        });
    }

    // New Chat button click handler
    const newChatBtn = document.getElementById('new-chat-btn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'newConversation' });
        });
    }

    // Handle menu item clicks
    document.querySelectorAll('.add-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            console.log('Add context action:', action);

            // Post message based on action
            vscode.postMessage({
                type: 'addContext',
                action: action
            });

            addDropdown?.classList.remove('show');
        });
    });

    // Breaking Changes Warning Display
    function showBreakingChangesWarning(filename, changes, message) {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;

        const warningDiv = document.createElement('div');
        warningDiv.className = 'breaking-changes-warning';

        const severityIcon = changes.some(c => c.severity === 'high') ? '🔴' :
            changes.some(c => c.severity === 'medium') ? '🟡' : '🟢';

        warningDiv.innerHTML = `
            <div class="warning-header">
                ${severityIcon} <strong>Breaking Changes Detected</strong>
            </div>
            <div class="warning-file">File: <code>${filename}</code></div>
            <div class="warning-details">
                <strong>${changes.length} potential issue(s) found:</strong>
                <ul>
                    ${changes.map(c => `
                        <li>
                            <strong>${c.type.replace(/_/g, ' ')}</strong>
                            ${c.affectedSymbol ? `- ${c.affectedSymbol}` : ''}
                            <br/>
                            <span class="impact">Impact: ${c.impactedFiles.length} file(s)</span>
                            ${c.suggestion ? `<br/><span class="suggestion">💡 ${c.suggestion}</span>` : ''}
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;

        chatMessages.appendChild(warningDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Context Gathered Notification
    function showContextGatheredNotification(data) {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;

        const notificationDiv = document.createElement('div');
        notificationDiv.className = 'context-notification';

        const confidencePercent = Math.round(data.confidence * 100);
        const confidenceColor = confidencePercent >= 70 ? '#4caf50' :
            confidencePercent >= 40 ? '#ff9800' : '#f44336';

        notificationDiv.innerHTML = `
            <div class="context-header">
                🔍 <strong>Codebase Context Gathered</strong>
            </div>
            <div class="context-details">
                <div class="context-item">
                    <span class="context-label">Intent:</span>
                    <span class="context-value">${data.intent}</span>
                </div>
                <div class="context-item">
                    <span class="context-label">Files Found:</span>
                    <span class="context-value">${data.filesFound}</span>
                </div>
                <div class="context-item">
                    <span class="context-label">Symbols Found:</span>
                    <span class="context-value">${data.symbolsFound}</span>
                </div>
                <div class="context-item">
                    <span class="context-label">Confidence:</span>
                    <span class="context-value" style="color: ${confidenceColor}">${confidencePercent}%</span>
                </div>
            </div>
        `;

        chatMessages.appendChild(notificationDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Auto-remove after 5 seconds
        setTimeout(() => {
            notificationDiv.style.opacity = '0';
            setTimeout(() => notificationDiv.remove(), 300);
        }, 5000);
    }
    function showCommandApproval(data) {
        const approvalDiv = document.createElement('div');
        approvalDiv.className = `approval-block ${data.isDangerous ? 'dangerous' : ''}`;
        approvalDiv.id = `approval-${data.id}`;

        const icon = data.isDangerous
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';

        const title = data.isDangerous ? 'DANGEROUS COMMAND' : 'COMMAND APPROVAL';

        approvalDiv.innerHTML = `
            <div class="approval-header">
                ${icon}
                <span>${title}</span>
            </div>
            <div class="approval-content">${data.command}</div>
            <div style="font-size: 10px; color: var(--text-dim); margin-top: -4px;">CWD: ${data.cwd}</div>
            <div class="approval-actions" id="actions-${data.id}">
                ${data.status === 'approved' ? '<span style="color: #4caf50; font-size: 11px; font-weight: 600;">✓ APPROVED</span>' :
                data.status === 'rejected' ? '<span style="color: #f44336; font-size: 11px; font-weight: 600;">✕ REJECTED</span>' :
                    `
                <button class="approval-btn approve-btn-inline">Approve</button>
                <button class="approval-btn reject-btn-inline">Reject</button>
                `}
            </div>
        `;

        messagesContainer.appendChild(approvalDiv);
        scrollToBottom();

        const actions = approvalDiv.querySelector(`#actions-${data.id}`);
        actions.addEventListener('click', (e) => {
            const isApprove = e.target.classList.contains('approve-btn-inline');
            const isReject = e.target.classList.contains('reject-btn-inline');

            if (isApprove || isReject) {
                vscode.postMessage({
                    type: 'approvalResponse',
                    id: data.id,
                    approved: isApprove
                });
                actions.innerHTML = `<span style="color: ${isApprove ? '#4caf50' : '#f44336'}; font-size: 11px; font-weight: 600;">
                    ${isApprove ? '✓ APPROVED' : '✕ REJECTED'}
                </span>`;
            }
        });
    }
    function stripAnsi(text) {
        if (typeof text !== 'string') return text;
        const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
        return text.replace(ansiRegex, '');
    }

    function getStatusIcon(status) {
        switch (status) {
            case 'completed': return '✅';
            case 'in_progress': return '⏳';
            default: return '⚪';
        }
    }

    function addArtifactMessage(artifact) {
        if (!messagesContainer || !artifact) return;

        let messageDiv = document.getElementById(`artifact-${artifact.metadata.id}`);
        const isNew = !messageDiv;

        if (isNew) {
            messageDiv = document.createElement('div');
            messageDiv.className = 'artifact-message';
            messageDiv.id = `artifact-${artifact.metadata.id}`;
        }

        if (artifact.metadata.type === 'implementation_plan') {
            try {
                const data = JSON.parse(artifact.content);
                messageDiv.innerHTML = `
                    <div class="artifact-header">
                        <div class="artifact-icon">📋</div>
                        <div class="artifact-title">${artifact.metadata.name}</div>
                    </div>
                    <div class="artifact-body">
                        ${data.requirements ? `<div class="plan-requirements">${data.requirements}</div>` : ''}
                        <div class="plan-tasks">
                            ${(data.tasks || []).map(task => `
                                <div class="plan-task ${task.status || 'pending'}" data-id="${task.id}">
                                    <div class="task-status-icon">${getStatusIcon(task.status)}</div>
                                    <div class="task-content">
                                        <div class="task-title">${task.title}</div>
                                        <div class="task-desc">${task.description || ''}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            } catch (e) {
                console.error('Failed to parse plan artifact:', e);
            }
        } else {
            messageDiv.innerHTML = `
                <div class="artifact-header">
                    <div class="artifact-icon">📄</div>
                    <div class="artifact-title">${artifact.metadata.name}</div>
                </div>
                <div class="artifact-body">
                    <div class="task-desc">${artifact.metadata.summary || 'Artifact created'}</div>
                </div>
            `;
        }

        if (isNew) {
            messagesContainer.appendChild(messageDiv);
        }

        scrollToBottom();
    }


    // Signal that the webview is ready
    // Request models from the extension backend
    vscode.postMessage({ type: 'getModels' });
    vscode.postMessage({ type: 'webviewReady' });
})();


