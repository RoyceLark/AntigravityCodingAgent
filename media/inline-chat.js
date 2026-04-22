(function () {
    const vscode = acquireVsCodeApi();
    const messagesContainer = document.getElementById('messages');
    const chatInput = document.getElementById('chat-input');
    const modelSelect = document.getElementById('model-select');
    const speedSelect = document.getElementById('speed-select');
    const micButton = document.getElementById('mic-button');
    const stopButton = document.getElementById('stop-button');

    function addMessage(text, role) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}-message`;

        if (role === 'user') {
            msgDiv.innerHTML = `
                <div class="user-message-content">
                    <div class="message-text">${text}</div>
                    <button class="resend-btn" title="Edit & Resend">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            `;

            const resendBtn = msgDiv.querySelector('.resend-btn');
            resendBtn?.addEventListener('click', () => {
                chatInput.value = text;
                chatInput.focus();
            });
        } else {
            msgDiv.innerHTML = text;
        }

        messagesContainer.appendChild(msgDiv);
        scrollToBottom();
        return msgDiv;
    }

    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function showSuggestedResponses(suggestions) {
        const container = document.getElementById('suggested-responses');
        if (!container) return;

        if (!suggestions || suggestions.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = suggestions.map(s => `
            <button class="suggested-response" data-text="${encodeURIComponent(s.text)}" title="${s.description || ''}">
                <span class="suggestion-icon">${s.icon || '💡'}</span>
                <span class="suggestion-text">${s.text}</span>
            </button>
        `).join('');

        container.querySelectorAll('.suggested-response').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = decodeURIComponent(btn.dataset.text);
                chatInput.value = text;
                chatInput.focus();
            });
        });
    }

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'addMessage':
                addMessage(message.text, message.role);
                break;

            case 'streamChunk':
                let lastBotMsg = [...document.querySelectorAll('.bot-message')].pop();
                if (!lastBotMsg || lastBotMsg.dataset.streaming !== 'true') {
                    lastBotMsg = addMessage('', 'bot');
                    lastBotMsg.dataset.streaming = 'true';
                    lastBotMsg.innerHTML = '';
                }
                lastBotMsg.dataset.rawText = (lastBotMsg.dataset.rawText || '') + message.text;
                lastBotMsg.innerHTML = lastBotMsg.dataset.rawText;
                scrollToBottom();
                break;

            case 'addResponse':
                const existingStream = [...document.querySelectorAll('.bot-message')].pop();
                if (existingStream && existingStream.dataset.streaming === 'true') {
                    existingStream.dataset.streaming = 'false';
                    existingStream.innerHTML = message.text;
                } else {
                    addMessage(message.text, 'bot');
                }
                break;

            case 'addToolCall':
                const toolDiv = document.createElement('div');
                toolDiv.className = 'tool-call';
                toolDiv.innerHTML = `
                    <div class="tool-header">
                        <svg class="anim-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
                        </svg>
                        <span>RUNNING ${message.tool.toUpperCase()}...</span>
                    </div>
                    <div class="tool-section">${message.args}</div>
                `;
                messagesContainer.appendChild(toolDiv);
                scrollToBottom();
                break;

            case 'updateToolResult':
                const lastTool = [...document.querySelectorAll('.tool-call')].pop();
                if (lastTool) {
                    const header = lastTool.querySelector('.tool-header');
                    if (header) {
                        const toolName = header.querySelector('span').innerText.replace('RUNNING ', '').replace('...', '');
                        header.innerHTML = `
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4facfe" stroke-width="3">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                            <span>${toolName} COMPLETED</span>
                        `;
                    }
                    const resultDiv = document.createElement('div');
                    resultDiv.className = 'tool-section';
                    resultDiv.innerText = message.result;
                    lastTool.appendChild(resultDiv);
                }
                break;

            case 'toolStats':
                const statsDiv = document.createElement('div');
                statsDiv.className = 'tool-stats';
                statsDiv.innerHTML = `
                    <span>📊 Executed ${message.count} tools in ${message.duration}ms (${message.success} succeeded, ${message.failed} failed)</span>
                `;
                messagesContainer.appendChild(statsDiv);
                scrollToBottom();
                break;

            case 'suggestedResponses':
                showSuggestedResponses(message.suggestions);
                break;

            case 'clearChat':
                messagesContainer.innerHTML = '';
                document.getElementById('suggested-responses').innerHTML = '';
                break;
        }
    });

    // Event Listeners
    modelSelect?.addEventListener('change', (e) => {
        vscode.postMessage({ type: 'changeModel', model: e.target.value });
    });

    speedSelect?.addEventListener('change', (e) => {
        vscode.postMessage({ type: 'changeSpeed', speed: e.target.value });
    });

    function sendMessage() {
        const text = chatInput.value.trim();
        if (text) {
            vscode.postMessage({ type: 'sendMessage', text });
            chatInput.value = '';
            document.getElementById('suggested-responses').innerHTML = '';
        }
    }

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    micButton?.addEventListener('click', () => {
        // Voice input placeholder
        console.log('Voice input clicked');
    });

    stopButton?.addEventListener('click', () => {
        vscode.postMessage({ type: 'stopGeneration' });
    });
})();
