const fs = require('fs');
let content = fs.readFileSync('media/main.js', 'utf8');

const regex = /function renderModelDropdown\(\) \{[\s\S]*?modelDropdown\.innerHTML = `[\s\S]*?`;/m;

const newFunc = `function renderModelDropdown() {
            const otherModels = models.filter((_, index) => index !== currentModelIndex);

            modelDropdown.innerHTML = \`
                <div class="dropdown-header">Model</div>
                \${otherModels.map((model, index) => {
                const actualIndex = models.findIndex(m => m.name === model.name);
                const icon = model.provider === 'ollama' ? '🏠 ' : '';
                return \\\`<div class="dropdown-item" data-index="\\\${actualIndex}">\${icon}\${model.displayName || model.name}</div>\\\`;
            }).join('')}
                <div class="dropdown-separator"></div>
                <div class="dropdown-current">\${models[currentModelIndex] ? (models[currentModelIndex].provider === 'ollama' ? '🏠 ' : '') + (models[currentModelIndex].displayName || models[currentModelIndex].name) : 'Select Model'}</div>
            \`;`;

content = content.replace(regex, newFunc);

// Also let's fix the click listener just in case
const listenerRegex = /modelSelect\.childNodes\[0\]\.textContent = models\[currentModelIndex\]\.name;[\s\S]*?vscode\.postMessage\(\{ type: 'changeModel', model: models\[currentModelIndex\]\.name \}\);/m;
const newListener = `const selectedModel = models[currentModelIndex];
                    modelSelect.childNodes[0].textContent = (selectedModel.provider === 'ollama' ? '🏠 ' : '') + (selectedModel.displayName || selectedModel.name);
                    modelDropdown.classList.remove('show');
                    vscode.postMessage({ type: 'changeModel', model: selectedModel.name, provider: selectedModel.provider });`;

content = content.replace(listenerRegex, newListener);

fs.writeFileSync('media/main.js', content);
console.log('Fixed main.js');
