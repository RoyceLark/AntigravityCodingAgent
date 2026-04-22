const fs = require('fs');
let content = fs.readFileSync('media/main.js', 'utf8');

// I will fix the function by splitting the string
const parts = content.split('function renderModelDropdown() {');
const before = parts[0];
const afterCorrupted = parts[1].split('modelDropdown.querySelectorAll(\'.dropdown-item\').forEach(item => {')[1];

const cleanFunction = `function renderModelDropdown() {
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
            \`;

            modelDropdown.querySelectorAll('.dropdown-item').forEach(item => {`;

fs.writeFileSync('media/main.js', before + cleanFunction + afterCorrupted);
console.log("main.js cleaned and updated successfully.");
