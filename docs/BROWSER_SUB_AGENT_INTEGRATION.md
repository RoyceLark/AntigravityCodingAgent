# BrowserSubAgent Integration Guide

## Integration with VS Code Extension

This guide shows how to integrate BrowserSubAgent into your VS Code extension for automated UI testing.

## Basic Integration Pattern

### Step 1: Add to VS Code Commands

Register a new command to run browser tests:

```typescript
// src/extension.ts
import { BrowserSubAgent, BrowserTestStep } from './services/BrowserSubAgent';

export function activate(context: vscode.ExtensionContext) {
  // Register test command
  const disposable = vscode.commands.registerCommand('extension.runBrowserTest', async () => {
    await runBrowserTest(context);
  });

  context.subscriptions.push(disposable);
}

async function runBrowserTest(context: vscode.ExtensionContext) {
  const agent = new BrowserSubAgent();

  try {
    // Show progress
    vscode.window.showInformationMessage('Starting browser test...');

    // Initialize
    await agent.initialize({ headless: true });

    // Define test
    const steps: BrowserTestStep[] = [
      {
        action: 'navigate',
        target: 'http://localhost:3000',
        description: 'Navigate to local dev server'
      },
      {
        action: 'assert_element',
        target: '[data-testid="app"]',
        description: 'Verify app is loaded'
      }
    ];

    // Run test
    const report = await agent.runTestFlow(
      context.extension.id,
      'http://localhost:3000',
      steps,
      'VS Code Extension Test'
    );

    // Save report
    const reportPath = await agent.exportReportHTML(report);

    // Open report
    const uri = vscode.Uri.file(reportPath);
    await vscode.commands.executeCommand('vscode.open', uri);

    // Show result
    if (report.overallStatus === 'passed') {
      vscode.window.showInformationMessage('All tests passed!');
    } else {
      vscode.window.showErrorMessage(`Tests failed: ${report.overallStatus}`);
    }

  } catch (error: any) {
    vscode.window.showErrorMessage(`Test error: ${error.message}`);
  } finally {
    await agent.cleanup();
  }
}
```

### Step 2: Add Command to package.json

```json
{
  "contributes": {
    "commands": [
      {
        "command": "extension.runBrowserTest",
        "title": "Run Browser Test",
        "category": "My Extension"
      }
    ]
  }
}
```

### Step 3: Add Keybinding (Optional)

```json
{
  "contributes": {
    "keybindings": [
      {
        "command": "extension.runBrowserTest",
        "key": "ctrl+shift+t",
        "mac": "cmd+shift+t"
      }
    ]
  }
}
```

## Integration with Dev Server

### Waiting for Dev Server to Start

```typescript
import { spawn } from 'child_process';
import axios from 'axios';

async function waitForDevServer(
  port: number = 3000,
  timeout: number = 30000
): Promise<void> {
  const startTime = Date.now();
  const baseUrl = `http://localhost:${port}`;

  while (Date.now() - startTime < timeout) {
    try {
      await axios.get(baseUrl, { timeout: 1000 });
      console.log(`Dev server is ready at ${baseUrl}`);
      return;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  throw new Error(`Dev server not ready after ${timeout}ms`);
}

async function runWithDevServer() {
  const agent = new BrowserSubAgent();

  // Start dev server
  const devServer = spawn('npm', ['run', 'dev'], {
    stdio: 'inherit'
  });

  try {
    // Wait for server to be ready
    await waitForDevServer(3000);

    // Initialize browser
    await agent.initialize();

    // Run tests
    const report = await agent.runTestFlow(
      'dev-server-test',
      'http://localhost:3000',
      [
        { action: 'navigate', target: 'http://localhost:3000', description: 'Load app' },
        { action: 'assert_element', target: '[data-testid="app"]', description: 'App ready' }
      ]
    );

    return report;

  } finally {
    await agent.cleanup();
    devServer.kill();
  }
}
```

## Integration with Testing Framework

### Jest Integration

```typescript
// src/__tests__/e2e.test.ts
import { BrowserSubAgent, BrowserTestStep } from '../services/BrowserSubAgent';

describe('E2E Tests', () => {
  let agent: BrowserSubAgent;

  beforeEach(async () => {
    agent = new BrowserSubAgent();
    await agent.initialize({ headless: true });
  });

  afterEach(async () => {
    await agent.cleanup();
  });

  test('homepage loads successfully', async () => {
    const report = await agent.runTestFlow(
      'jest-test-1',
      'http://localhost:3000',
      [
        { action: 'navigate', target: 'http://localhost:3000', description: 'Load' },
        { action: 'assert_element', target: 'h1', description: 'Title' }
      ]
    );

    expect(report.overallStatus).toBe('passed');
  });

  test('form submission works', async () => {
    const report = await agent.runTestFlow(
      'jest-test-2',
      'http://localhost:3000/contact',
      [
        { action: 'navigate', target: 'http://localhost:3000/contact', description: 'Form page' },
        { action: 'fill', target: 'input[name="email"]', value: 'test@example.com', description: 'Email' },
        { action: 'click', target: 'button[type="submit"]', description: 'Submit' },
        { action: 'wait', value: '2000', description: 'Wait' },
        { action: 'assert_text', target: '.success', value: 'Success', description: 'Message' }
      ]
    );

    expect(report.overallStatus).toBe('passed');
  });
});
```

Run with:
```bash
npm test -- e2e.test.ts
```

## Integration with CI/CD

### GitHub Actions Example

```yaml
# .github/workflows/e2e-test.yml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Install Playwright
        run: npx playwright install

      - name: Start dev server
        run: npm run dev &

      - name: Wait for server
        run: npx wait-on http://localhost:3000

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: e2e-reports
          path: .agent/screenshots/
```

### GitLab CI Example

```yaml
# .gitlab-ci.yml
e2e_tests:
  image: node:18
  script:
    - npm install
    - npx playwright install
    - npm run dev &
    - npx wait-on http://localhost:3000
    - npm run test:e2e
  artifacts:
    paths:
      - .agent/screenshots/
    when: always
```

## Reporting Integration

### Slack Integration

```typescript
import axios from 'axios';

async function reportToSlack(report: BrowserTestReport, webhookUrl: string) {
  const passed = report.steps.filter(s => s.status === 'passed').length;
  const failed = report.steps.filter(s => s.status === 'failed').length;

  const color = report.overallStatus === 'passed' ? 'good' : 'danger';

  const message = {
    attachments: [
      {
        color,
        title: report.title,
        fields: [
          { title: 'Status', value: report.overallStatus.toUpperCase(), short: true },
          { title: 'Duration', value: `${report.totalDuration}ms`, short: true },
          { title: 'Passed', value: `${passed}/${report.steps.length}`, short: true },
          { title: 'Failed', value: `${failed}/${report.steps.length}`, short: true },
          { title: 'URL', value: report.url, short: false }
        ]
      }
    ]
  };

  await axios.post(webhookUrl, message);
}

// Usage
const report = await agent.runTestFlow(...);
await reportToSlack(report, process.env.SLACK_WEBHOOK_URL!);
```

### Email Integration

```typescript
import nodemailer from 'nodemailer';

async function emailReport(report: BrowserTestReport, htmlPath: string) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const html = await fs.readFile(htmlPath, 'utf-8');

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: 'team@example.com',
    subject: `Test Results: ${report.title} - ${report.overallStatus.toUpperCase()}`,
    html: html
  });
}

// Usage
const report = await agent.runTestFlow(...);
const htmlPath = await agent.exportReportHTML(report);
await emailReport(report, htmlPath);
```

## Custom Test Builder

Create a test builder for cleaner syntax:

```typescript
class TestBuilder {
  private steps: BrowserTestStep[] = [];

  navigate(url: string, description?: string): this {
    this.steps.push({
      action: 'navigate',
      target: url,
      description: description || `Navigate to ${url}`
    });
    return this;
  }

  click(selector: string, description?: string): this {
    this.steps.push({
      action: 'click',
      target: selector,
      description: description || `Click ${selector}`
    });
    return this;
  }

  fill(selector: string, value: string, description?: string): this {
    this.steps.push({
      action: 'fill',
      target: selector,
      value,
      description: description || `Fill ${selector}`
    });
    return this;
  }

  assert(selector: string, text?: string, description?: string): this {
    if (text) {
      this.steps.push({
        action: 'assert_text',
        target: selector,
        value: text,
        description: description || `Assert "${text}" in ${selector}`
      });
    } else {
      this.steps.push({
        action: 'assert_element',
        target: selector,
        description: description || `Assert ${selector} exists`
      });
    }
    return this;
  }

  screenshot(name?: string, description?: string): this {
    this.steps.push({
      action: 'screenshot',
      target: name,
      description: description || `Screenshot: ${name}`
    });
    return this;
  }

  wait(ms: number): this {
    this.steps.push({
      action: 'wait',
      value: ms.toString(),
      description: `Wait ${ms}ms`
    });
    return this;
  }

  async run(agent: BrowserSubAgent, agentId: string, url: string, title: string) {
    return await agent.runTestFlow(agentId, url, this.steps, title);
  }
}

// Usage
const builder = new TestBuilder();
const report = await builder
  .navigate('http://localhost:3000')
  .assert('[data-testid="app"]')
  .click('button.menu')
  .screenshot('menu-open')
  .run(agent, 'builder-test', 'http://localhost:3000', 'Builder Test');
```

## Visual Regression Detection

Compare screenshots between test runs:

```typescript
import sharp from 'sharp';

async function detectVisualRegression(
  beforePath: string,
  afterPath: string,
  threshold: number = 0.05 // 5% difference
): Promise<{ changed: boolean; difference: number }> {
  // This is a simplified example
  // For production, use pixelmatch or similar
  const before = await sharp(beforePath).metadata();
  const after = await sharp(afterPath).metadata();

  const changed = before.width !== after.width || before.height !== after.height;

  return {
    changed,
    difference: 0
  };
}

async function runRegressionTest(
  baselineDir: string,
  currentDir: string
) {
  const files = await fs.readdir(baselineDir);

  for (const file of files) {
    if (!file.endsWith('.png')) continue;

    const beforePath = path.join(baselineDir, file);
    const afterPath = path.join(currentDir, file);

    if (!(await fs.stat(afterPath).catch(() => null))) {
      console.warn(`Missing: ${file}`);
      continue;
    }

    const result = await detectVisualRegression(beforePath, afterPath);

    if (result.changed) {
      console.error(`REGRESSION: ${file} (${result.difference}% different)`);
    }
  }
}
```

## Performance Monitoring

Track test performance over time:

```typescript
interface PerformanceRecord {
  timestamp: Date;
  testName: string;
  duration: number;
  stepCount: number;
  status: string;
}

class PerformanceMonitor {
  private records: PerformanceRecord[] = [];

  record(report: BrowserTestReport) {
    this.records.push({
      timestamp: report.startedAt,
      testName: report.title,
      duration: report.totalDuration,
      stepCount: report.steps.length,
      status: report.overallStatus
    });
  }

  async saveMetrics(path: string) {
    await fs.writeFile(path, JSON.stringify(this.records, null, 2));
  }

  getAverageDuration(testName: string): number {
    const matching = this.records.filter(r => r.testName === testName);
    if (!matching.length) return 0;
    return matching.reduce((sum, r) => sum + r.duration, 0) / matching.length;
  }

  getSuccessRate(testName: string): number {
    const matching = this.records.filter(r => r.testName === testName);
    if (!matching.length) return 0;
    const passed = matching.filter(r => r.status === 'passed').length;
    return (passed / matching.length) * 100;
  }
}

// Usage
const monitor = new PerformanceMonitor();

// ... run tests
const report = await agent.runTestFlow(...);
monitor.record(report);

// ... after multiple runs
await monitor.saveMetrics('.agent/metrics.json');

console.log(`Average duration: ${monitor.getAverageDuration('My Test')}ms`);
console.log(`Success rate: ${monitor.getSuccessRate('My Test')}%`);
```

## Advanced: Custom Test Reporters

```typescript
abstract class TestReporter {
  abstract report(report: BrowserTestReport): Promise<void>;
}

class CustomReporter extends TestReporter {
  async report(report: BrowserTestReport): Promise<void> {
    console.log(`
    ╔════════════════════════════════════╗
    ║ TEST REPORT: ${report.title.padEnd(20)} ║
    ║ Status: ${report.overallStatus.toUpperCase().padEnd(27)} ║
    ║ Duration: ${report.totalDuration}ms${' '.repeat(23)} ║
    ║ Steps: ${report.steps.length}/${report.steps.length} passed    ║
    ╚════════════════════════════════════╝
    `);

    report.steps.forEach((step, i) => {
      const icon = step.status === 'passed' ? '✓' : '✗';
      console.log(`  ${icon} ${step.step.description} (${step.duration}ms)`);
    });
  }
}

// Usage
const reporter = new CustomReporter();
const report = await agent.runTestFlow(...);
await reporter.report(report);
```

## Best Practices for Integration

1. **Always use try/finally**: Ensures cleanup even if test fails
2. **Handle dev server lifecycle**: Start, wait, stop properly
3. **Collect metrics**: Track performance over time
4. **Report results**: Send to CI/CD, Slack, email
5. **Archive artifacts**: Save reports for historical reference
6. **Use environment variables**: Don't hardcode URLs or credentials
7. **Implement retry logic**: Handle flaky tests gracefully
8. **Monitor resources**: Watch browser memory usage

## Troubleshooting Integration

### Issue: Tests timeout in CI
**Solution**: Increase timeouts, ensure dev server starts before tests
```typescript
await agent.initialize({ headless: true });
// Add explicit waits
await new Promise(r => setTimeout(r, 5000));
```

### Issue: Port already in use
**Solution**: Kill existing processes or use dynamic ports
```typescript
const port = await getAvailablePort();
const devServer = spawn('npm', ['run', 'dev', '--', '--port', port.toString()]);
```

### Issue: Screenshots not captured
**Solution**: Ensure disk space and check `.agent/` directory permissions
```typescript
const exists = await fs.stat('.agent/screenshots').catch(() => null);
if (!exists) {
  await fs.mkdir('.agent/screenshots', { recursive: true });
}
```

## Example: Complete Integration

See `BrowserSubAgent.example.ts` for complete, runnable examples of integration patterns.
