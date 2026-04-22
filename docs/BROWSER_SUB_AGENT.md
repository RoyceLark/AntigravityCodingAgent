# BrowserSubAgent - Production-Grade Browser Testing Service

## Overview

The `BrowserSubAgent` is a production-grade service for autonomous browser testing and validation in VS Code extensions. It implements Google Antigravity-style sub-agents with autonomous test execution capabilities, enabling E2E testing, visual regression detection, and feature validation with minimal configuration.

**Location:** `/src/services/BrowserSubAgent.ts`

## Key Features

- **Autonomous Test Execution**: Run entire test flows with a single method call
- **Comprehensive Screenshot Capture**: Automatic before/after screenshots for each step
- **Error Recovery**: Graceful error handling with detailed reporting
- **Event Streaming**: Real-time progress updates via event emitters
- **Visual Regression Detection**: Base64-encoded screenshots for comparison
- **HTML Report Generation**: Beautiful, self-contained HTML reports
- **Network & Console Monitoring**: Capture all errors and warnings
- **Responsive Testing**: Test multiple viewport sizes
- **Video & Trace Recording**: Optional Playwright trace and video capture
- **Production-Ready Logging**: Comprehensive debug and error logging

## Architecture

### Core Interfaces

#### BrowserTestStep
```typescript
interface BrowserTestStep {
  action: 'navigate' | 'click' | 'type' | 'screenshot' | 'wait' | 'assert_text' | 'assert_element' | 'scroll' | 'hover' | 'select' | 'fill';
  target?: string;           // CSS selector or URL
  value?: string;            // Value for type/fill/assert
  description: string;       // Human-readable description
  timeout?: number;          // Custom timeout in milliseconds
}
```

#### BrowserTestResult
```typescript
interface BrowserTestResult {
  stepIndex: number;
  step: BrowserTestStep;
  status: 'passed' | 'failed' | 'skipped';
  screenshotPath?: string;
  screenshotBase64?: string;
  error?: string;
  duration: number;
  timestamp: Date;
}
```

#### BrowserTestReport
```typescript
interface BrowserTestReport {
  id: string;
  agentId: string;
  url: string;
  title: string;
  steps: BrowserTestResult[];
  overallStatus: 'passed' | 'failed' | 'partial';
  totalDuration: number;
  startedAt: Date;
  completedAt: Date;
  screenshots: ScreenshotMetadata[];
  consoleErrors: string[];
  networkErrors: string[];
}
```

## Usage

### Basic Setup

```typescript
import { BrowserSubAgent, BrowserTestStep } from './services/BrowserSubAgent';

const agent = new BrowserSubAgent();

// Initialize browser
await agent.initialize({
  headless: true,
  viewport: { width: 1280, height: 720 },
  recordVideo: false
});

// Define test steps
const steps: BrowserTestStep[] = [
  {
    action: 'navigate',
    target: 'https://example.com',
    description: 'Navigate to homepage'
  },
  {
    action: 'assert_element',
    target: 'h1',
    description: 'Verify main heading exists'
  }
];

// Run test flow
const report = await agent.runTestFlow(
  'agent-001',
  'https://example.com',
  steps,
  'My Test'
);

// Save reports
await agent.saveReport(report);
await agent.exportReportHTML(report);

// Cleanup
await agent.cleanup();
```

### Supported Actions

#### navigate
Navigate to a URL and wait for network idle.
```typescript
{
  action: 'navigate',
  target: 'https://example.com',
  description: 'Navigate to homepage',
  timeout: 30000  // Optional: custom timeout
}
```

#### click
Click an element matching the selector.
```typescript
{
  action: 'click',
  target: 'button[data-testid="submit"]',
  description: 'Click submit button'
}
```

#### type
Type text into an input field (clears first, then types with delay).
```typescript
{
  action: 'type',
  target: 'input[name="email"]',
  value: 'test@example.com',
  description: 'Enter email address'
}
```

#### fill
Fill an input field with a value (faster than type, no character delay).
```typescript
{
  action: 'fill',
  target: 'input[name="password"]',
  value: 'MyPassword123',
  description: 'Fill password field'
}
```

#### select
Select an option from a dropdown.
```typescript
{
  action: 'select',
  target: 'select[name="country"]',
  value: 'US',
  description: 'Select country'
}
```

#### scroll
Scroll an element into view.
```typescript
{
  action: 'scroll',
  target: '.product-list',
  description: 'Scroll to product list'
}
```

#### hover
Hover over an element (useful for dropdowns, tooltips).
```typescript
{
  action: 'hover',
  target: 'button.menu-trigger',
  description: 'Hover over menu'
}
```

#### wait
Wait for a specified duration.
```typescript
{
  action: 'wait',
  value: '2000',
  description: 'Wait for animation to complete'
}
```

#### screenshot
Take an explicit screenshot.
```typescript
{
  action: 'screenshot',
  target: 'final-state',
  description: 'Take screenshot of final state'
}
```

#### assert_element
Assert that an element exists.
```typescript
{
  action: 'assert_element',
  target: '.success-message',
  description: 'Verify success message appears',
  timeout: 5000
}
```

#### assert_text
Assert that an element contains specific text.
```typescript
{
  action: 'assert_text',
  target: '.error-message',
  value: 'Email is required',
  description: 'Verify validation error'
}
```

## API Reference

### Constructor
```typescript
constructor(workspaceDir: string = process.cwd())
```

### Methods

#### initialize(options?: BrowserInitOptions): Promise<void>
Initialize the browser with specified options.

**Options:**
```typescript
interface BrowserInitOptions {
  headless?: boolean;           // Default: true
  viewport?: { width, height }; // Default: 1280x720
  recordVideo?: boolean;        // Default: false
  recordTrace?: boolean;        // Default: false
}
```

#### runTestFlow(agentId: string, url: string, steps: BrowserTestStep[], title?: string): Promise<BrowserTestReport>
Execute an entire test flow autonomously.

#### takeScreenshot(name: string): Promise<{ path: string; base64: string }>
Take a screenshot and return both file path and base64 encoded data.

#### executeStep(step: BrowserTestStep): Promise<BrowserTestResult>
Execute a single test step.

#### assertElement(selector: string, timeout?: number): Promise<boolean>
Check if an element exists on the page.

#### assertText(selector: string, expectedText: string, timeout?: number): Promise<boolean>
Check if an element contains specific text.

#### getPageContent(): Promise<string>
Get the full HTML content of the current page.

#### getConsoleErrors(): Promise<string[]>
Get all console errors from the page session.

#### waitForNetworkIdle(timeout?: number): Promise<void>
Wait for network activity to stabilize.

#### saveReport(report: BrowserTestReport, outputPath?: string): Promise<string>
Save test report to JSON file.

#### exportReportHTML(report: BrowserTestReport, outputPath?: string): Promise<string>
Export test report to beautiful HTML file.

#### cleanup(): Promise<void>
Close browser and cleanup resources.

#### forceQuit(): Promise<void>
Force quit the browser (emergency shutdown).

#### getBrowserVersion(): Promise<string | null>
Get the installed Chromium version.

### Events

#### onStepComplete
Emitted when a test step completes.

```typescript
agent.onStepComplete(({ stepIndex, result }) => {
  console.log(`Step ${stepIndex + 1}: ${result.status}`);
});
```

#### onTestComplete
Emitted when the entire test flow completes.

```typescript
agent.onTestComplete(({ report }) => {
  console.log(`Test completed: ${report.overallStatus}`);
});
```

## Output Structure

By default, artifacts are stored in:
```
<workspace>/.agent/
├── screenshots/    # Screenshot files and reports
├── recordings/     # Video recordings (if recordVideo: true)
└── traces/         # Playwright traces (if recordTrace: true)
```

## Report Format

### JSON Report
Contains full test metadata, all steps, and base64-encoded screenshots.

### HTML Report
Beautiful, self-contained HTML report with:
- Test status badge
- Summary statistics
- Step-by-step results table
- Embedded screenshots
- Console error logs
- Network error logs

## Error Handling

The agent implements graceful error recovery:
- **Step Failures**: Captured with error screenshot, continues to next step
- **Navigation Timeouts**: Defaults to 30 seconds, can be customized
- **Missing Elements**: Returns specific error message
- **Console Errors**: Automatically captured and reported
- **Network Errors**: 4xx and 5xx responses tracked

## Performance Considerations

- **Timeouts**: Default 5 seconds per action, customizable per step
- **Screenshot Delay**: 100ms between steps for stability
- **Network Idle**: Waits for network stabilization (3 second default)
- **Parallel Execution**: Can run multiple agents in parallel
- **Memory**: Each browser context ~50-100MB

## Best Practices

### 1. Use Descriptive Step Descriptions
```typescript
// Good
{ action: 'click', target: '.submit', description: 'Click submit button to create account' }

// Bad
{ action: 'click', target: '.submit', description: 'click' }
```

### 2. Wait for Dynamic Content
```typescript
// Good - wait for content to load
{ action: 'click', target: '.menu-trigger', description: 'Open menu' },
{ action: 'wait', value: '500', description: 'Wait for menu animation' },
{ action: 'assert_element', target: '.menu-item', description: 'Verify menu items' }

// Bad - assumes instant rendering
{ action: 'click', target: '.menu-trigger', description: 'Open menu' },
{ action: 'assert_element', target: '.menu-item', description: 'Check menu' }
```

### 3. Use Specific Selectors
```typescript
// Good - specific and stable
{ action: 'click', target: 'button[data-testid="signup"]', description: 'Sign up' }

// Bad - brittle to HTML changes
{ action: 'click', target: 'body > div > button', description: 'Sign up' }
```

### 4. Always Cleanup
```typescript
try {
  await agent.initialize();
  // ... test code
} finally {
  await agent.cleanup();  // Always execute
}
```

### 5. Monitor Console and Network Errors
```typescript
const report = await agent.runTestFlow(...);

if (report.consoleErrors.length > 0) {
  console.warn('Console errors detected:', report.consoleErrors);
}

if (report.networkErrors.length > 0) {
  console.warn('Network errors detected:', report.networkErrors);
}
```

## Troubleshooting

### Playwright Not Installed
**Error**: `Playwright not installed. Run: npm install playwright`

**Solution**:
```bash
npm install playwright
```

### Selector Not Found
**Error**: `Element not found: .my-selector`

**Solution**:
1. Verify the selector with browser DevTools
2. Add a wait step before asserting
3. Use more specific selectors

### Timeout Errors
**Error**: `Timeout waiting for element`

**Solution**:
1. Increase timeout for slow operations: `timeout: 10000`
2. Add explicit wait steps: `action: 'wait', value: '2000'`
3. Wait for network idle: `agent.waitForNetworkIdle(5000)`

### Screenshot Issues
**Error**: Screenshots not being captured

**Solution**:
1. Check `.agent/screenshots/` directory exists
2. Verify disk space available
3. Check file permissions

### Browser Crashes
**Error**: Browser process died unexpectedly

**Solution**:
1. Reduce parallel agents (run sequentially)
2. Lower viewport size
3. Disable video/trace recording
4. Increase timeouts for slow operations

## Integration with VS Code Extension

### Using in Commands
```typescript
import { BrowserSubAgent } from './services/BrowserSubAgent';

vscode.commands.registerCommand('extension.runBrowserTest', async () => {
  const agent = new BrowserSubAgent();

  try {
    await agent.initialize();

    const report = await agent.runTestFlow(
      vscode.env.appName,
      'https://my-app.local',
      myTestSteps,
      'My E2E Test'
    );

    // Show report in webview or notification
    vscode.window.showInformationMessage(
      `Test completed: ${report.overallStatus}`
    );

    // Open report HTML
    const reportPath = await agent.exportReportHTML(report);
    // ... open in editor or external viewer

  } finally {
    await agent.cleanup();
  }
});
```

### Using in Tests
```typescript
import { BrowserSubAgent } from '../src/services/BrowserSubAgent';

describe('BrowserSubAgent', () => {
  let agent: BrowserSubAgent;

  beforeEach(async () => {
    agent = new BrowserSubAgent();
    await agent.initialize({ headless: true });
  });

  afterEach(async () => {
    await agent.cleanup();
  });

  it('should navigate and assert elements', async () => {
    const report = await agent.runTestFlow(
      'test-agent',
      'http://localhost:3000',
      [
        { action: 'navigate', target: 'http://localhost:3000', description: 'Home' },
        { action: 'assert_element', target: 'h1', description: 'Check title' }
      ]
    );

    expect(report.overallStatus).toBe('passed');
    expect(report.steps[0].status).toBe('passed');
  });
});
```

## Performance Metrics

Typical execution times for a 10-step test:
- **Initialization**: 2-3 seconds
- **Per Step**: 200-500ms (varies by action)
- **Screenshot**: 100-200ms
- **Cleanup**: 1-2 seconds
- **Total**: 10-15 seconds

## Resource Usage

- **Browser Memory**: 50-100MB per context
- **Screenshot Size**: 50-200KB per screenshot (PNG)
- **Disk Space**: Plan for 100-500KB per test run
- **CPU**: Peaks during navigation and rendering

## Security Considerations

- **No Secrets in Steps**: Don't hardcode credentials in test steps
- **Screenshot Sensitivity**: Reports contain page screenshots
- **Local Storage**: Cleared between test runs
- **Cookies**: Isolated per context

## Logging

All operations are logged to console with `BrowserSubAgent:` prefix:

```
BrowserSubAgent: Initialized with workspace /path/to/workspace
BrowserSubAgent: Initializing browser...
BrowserSubAgent: Browser launched
BrowserSubAgent: Initialization complete
BrowserSubAgent: Starting test flow "My Test" (ID: abc123)
BrowserSubAgent: Executing step 1/5: Navigate to homepage
BrowserSubAgent: Step 1 PASSED (1234ms)
...
============================================================
BrowserSubAgent: Test Report - My Test
============================================================
Overall Status: PASSED
Duration: 12345ms
Passed: 5/5
...
```

## Advanced Usage

### Custom Viewport Testing
```typescript
const viewports = [
  { width: 320, height: 568 },   // iPhone
  { width: 768, height: 1024 },  // iPad
  { width: 1920, height: 1080 }  // Desktop
];

for (const viewport of viewports) {
  const agent = new BrowserSubAgent();
  await agent.initialize({ viewport });
  // ... test
}
```

### Parallel Test Execution
```typescript
const agents = Array(4).fill(null).map(() => new BrowserSubAgent());

const results = await Promise.all(
  agents.map(async (agent, index) => {
    await agent.initialize();
    try {
      return await agent.runTestFlow(...);
    } finally {
      await agent.cleanup();
    }
  })
);
```

### Recording Sessions
```typescript
await agent.initialize({
  recordVideo: true,
  recordTrace: true
});

// Videos saved to .agent/recordings/
// Traces saved to .agent/traces/
```

## Limitations

- Requires Chromium/Chrome installation
- No support for multiple browser tabs (use contexts)
- No support for iframes (use frame selectors)
- JavaScript must be enabled
- No proxy support (currently)

## Future Enhancements

Planned features:
- Multi-tab support
- Custom JavaScript execution
- Performance metrics collection
- Visual regression detection API
- CI/CD integration helpers
- Retry logic for flaky tests
- Screenshots comparison utilities

## Contributing

When adding new actions or features:
1. Add interface definitions
2. Implement in `executeStep()`
3. Add documentation
4. Add examples
5. Update this README

## License

Part of the cnx-agent VS Code extension.
