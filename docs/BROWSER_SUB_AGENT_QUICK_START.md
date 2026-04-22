# BrowserSubAgent - Quick Start Guide

## Installation

The `BrowserSubAgent` requires Playwright to be installed (already in `package.json`):

```bash
npm install
```

## 5-Minute Quick Start

### 1. Import and Create Agent

```typescript
import { BrowserSubAgent, BrowserTestStep } from './services/BrowserSubAgent';

const agent = new BrowserSubAgent();
```

### 2. Initialize Browser

```typescript
await agent.initialize({
  headless: true,
  viewport: { width: 1280, height: 720 }
});
```

### 3. Define Test Steps

```typescript
const steps: BrowserTestStep[] = [
  {
    action: 'navigate',
    target: 'https://example.com',
    description: 'Navigate to homepage'
  },
  {
    action: 'click',
    target: 'button.submit',
    description: 'Click submit button'
  },
  {
    action: 'screenshot',
    target: 'final-state',
    description: 'Take final screenshot'
  }
];
```

### 4. Run Test Flow

```typescript
const report = await agent.runTestFlow(
  'my-agent-id',
  'https://example.com',
  steps,
  'My Test Title'
);
```

### 5. Save Reports

```typescript
await agent.saveReport(report);              // JSON
await agent.exportReportHTML(report);        // HTML
```

### 6. Cleanup

```typescript
await agent.cleanup();
```

## Complete Minimal Example

```typescript
import { BrowserSubAgent, BrowserTestStep } from './services/BrowserSubAgent';

async function runTest() {
  const agent = new BrowserSubAgent();

  try {
    // Initialize
    await agent.initialize();

    // Define test
    const steps: BrowserTestStep[] = [
      { action: 'navigate', target: 'https://example.com', description: 'Home' },
      { action: 'assert_element', target: 'h1', description: 'Header exists' },
      { action: 'screenshot', target: 'page', description: 'Screenshot' }
    ];

    // Run test
    const report = await agent.runTestFlow(
      'agent-1',
      'https://example.com',
      steps,
      'Quick Test'
    );

    // Check results
    console.log(`Status: ${report.overallStatus}`);
    console.log(`Duration: ${report.totalDuration}ms`);

  } finally {
    await agent.cleanup();
  }
}

// Execute
runTest().catch(console.error);
```

## Common Test Patterns

### Form Submission

```typescript
const steps: BrowserTestStep[] = [
  { action: 'navigate', target: 'https://example.com/form', description: 'Form page' },
  { action: 'fill', target: 'input[name="email"]', value: 'test@example.com', description: 'Email' },
  { action: 'fill', target: 'input[name="password"]', value: 'pass123', description: 'Password' },
  { action: 'click', target: 'button[type="submit"]', description: 'Submit' },
  { action: 'wait', value: '2000', description: 'Wait for response' },
  { action: 'assert_text', target: '.success', value: 'Success', description: 'Success message' }
];
```

### Multi-page Navigation

```typescript
const steps: BrowserTestStep[] = [
  { action: 'navigate', target: 'https://example.com', description: 'Home' },
  { action: 'click', target: 'a[href="/about"]', description: 'About link' },
  { action: 'assert_element', target: '.about-content', description: 'About page' },
  { action: 'click', target: 'a[href="/contact"]', description: 'Contact link' },
  { action: 'assert_element', target: 'form', description: 'Contact form' }
];
```

### Dynamic Content

```typescript
const steps: BrowserTestStep[] = [
  { action: 'navigate', target: 'https://example.com/list', description: 'List page' },
  { action: 'wait', value: '2000', description: 'Load content' },
  { action: 'scroll', target: '.content', description: 'Scroll down' },
  { action: 'wait', value: '1000', description: 'Load more' },
  { action: 'screenshot', target: 'list-loaded', description: 'Final state' }
];
```

### Dropdown Selection

```typescript
const steps: BrowserTestStep[] = [
  { action: 'navigate', target: 'https://example.com/form', description: 'Form' },
  { action: 'select', target: 'select[name="country"]', value: 'US', description: 'Country' },
  { action: 'screenshot', target: 'selected', description: 'After selection' }
];
```

## Available Actions Reference

| Action | Target | Value | Example |
|--------|--------|-------|---------|
| navigate | URL | - | `{ action: 'navigate', target: 'https://example.com' }` |
| click | selector | - | `{ action: 'click', target: '.button' }` |
| type | selector | text | `{ action: 'type', target: 'input', value: 'text' }` |
| fill | selector | text | `{ action: 'fill', target: 'input', value: 'text' }` |
| select | selector | value | `{ action: 'select', target: 'select', value: 'option' }` |
| scroll | selector | - | `{ action: 'scroll', target: '.list' }` |
| hover | selector | - | `{ action: 'hover', target: '.item' }` |
| wait | - | ms | `{ action: 'wait', value: '1000' }` |
| screenshot | name | - | `{ action: 'screenshot', target: 'name' }` |
| assert_element | selector | - | `{ action: 'assert_element', target: '.msg' }` |
| assert_text | selector | text | `{ action: 'assert_text', target: '.msg', value: 'Success' }` |

## Event Listeners

### Monitor Progress

```typescript
agent.onStepComplete(({ stepIndex, result }) => {
  console.log(`Step ${stepIndex + 1}: ${result.status}`);
});

agent.onTestComplete(({ report }) => {
  console.log(`Test finished: ${report.overallStatus}`);
});
```

## Output Files

After running a test, check:

```
<workspace>/.agent/
├── screenshots/
│   ├── step-1-navigate-*.png
│   ├── step-2-click-*.png
│   ├── report-*.json
│   └── report-*.html
├── recordings/          (if recordVideo: true)
└── traces/              (if recordTrace: true)
```

Open the HTML report in a browser for visual results.

## Debugging Tips

### Check Browser Version

```typescript
const version = await agent.getBrowserVersion();
console.log(`Chromium version: ${version}`);
```

### Get Page Content

```typescript
const html = await agent.getPageContent();
console.log(html);
```

### Check Console Errors

```typescript
const errors = await agent.getConsoleErrors();
console.log('Console errors:', errors);
```

### Wait for Network

```typescript
await agent.waitForNetworkIdle(5000);
```

## Initialization Options

```typescript
await agent.initialize({
  headless: true,                         // Show browser UI
  viewport: { width: 1280, height: 720 }, // Screen size
  recordVideo: true,                      // Save video recording
  recordTrace: true                       // Save detailed trace
});
```

## Error Handling

The agent continues execution even on step failures:

```typescript
const report = await agent.runTestFlow(...);

// Check overall status
if (report.overallStatus === 'failed') {
  // Find failed steps
  report.steps.forEach((step, i) => {
    if (step.status === 'failed') {
      console.error(`Step ${i + 1} failed: ${step.error}`);
    }
  });
}

// Check for errors
if (report.consoleErrors.length > 0) {
  console.warn('Console errors:', report.consoleErrors);
}
```

## Responsive Testing

Test multiple screen sizes:

```typescript
const sizes = [
  { name: 'Mobile', width: 375, height: 667 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Desktop', width: 1920, height: 1080 }
];

for (const size of sizes) {
  const agent = new BrowserSubAgent();
  await agent.initialize({ viewport: { width: size.width, height: size.height } });
  // ... run test
  await agent.cleanup();
}
```

## Parallel Execution

Run multiple tests simultaneously:

```typescript
const results = await Promise.all([
  runTest('test-1'),
  runTest('test-2'),
  runTest('test-3')
]);
```

## Common Issues

| Issue | Solution |
|-------|----------|
| "Playwright not installed" | Run `npm install playwright` |
| "Element not found" | Wait before asserting: `{ action: 'wait', value: '1000' }` |
| "Timeout" | Increase timeout: `timeout: 10000` |
| "No screenshots" | Check `.agent/screenshots/` directory exists and has space |
| "Browser crashes" | Run one test at a time, reduce viewport size |

## Next Steps

- Read full documentation: [`docs/BROWSER_SUB_AGENT.md`](./BROWSER_SUB_AGENT.md)
- View examples: [`src/services/BrowserSubAgent.example.ts`](../src/services/BrowserSubAgent.example.ts)
- Check test patterns in example file

## Integration Checklist

- [ ] Import `BrowserSubAgent` in your code
- [ ] Create test steps array
- [ ] Call `initialize()` to start browser
- [ ] Call `runTestFlow()` to execute tests
- [ ] Call `saveReport()` and `exportReportHTML()` to save results
- [ ] Call `cleanup()` in finally block
- [ ] Open `.agent/screenshots/report-*.html` to view results

---

**Need more help?** See the full documentation in `docs/BROWSER_SUB_AGENT.md`
