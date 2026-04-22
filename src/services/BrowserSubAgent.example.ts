/**
 * BrowserSubAgent Usage Examples
 *
 * This file demonstrates how to use the production-grade BrowserSubAgent
 * for autonomous browser testing and validation.
 */

import { BrowserSubAgent, BrowserTestStep, BrowserTestReport } from './BrowserSubAgent';

/**
 * Example 1: Basic E2E Test Flow
 */
export async function exampleBasicE2ETest() {
    const agent = new BrowserSubAgent();

    try {
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
            },
            {
                action: 'click',
                target: 'button[data-testid="signup-btn"]',
                description: 'Click signup button'
            },
            {
                action: 'wait',
                value: '2000',
                description: 'Wait for form to load'
            },
            {
                action: 'fill',
                target: 'input[name="email"]',
                value: 'test@example.com',
                description: 'Enter email address'
            },
            {
                action: 'fill',
                target: 'input[name="password"]',
                value: 'SecurePassword123!',
                description: 'Enter password'
            },
            {
                action: 'click',
                target: 'button[type="submit"]',
                description: 'Submit form'
            },
            {
                action: 'wait',
                value: '3000',
                description: 'Wait for submission to complete'
            },
            {
                action: 'assert_text',
                target: '.success-message',
                value: 'Account created successfully',
                description: 'Verify success message'
            },
            {
                action: 'screenshot',
                target: 'final-state',
                description: 'Take final screenshot'
            }
        ];

        // Run test flow
        const report = await agent.runTestFlow(
            'agent-001',
            'https://example.com',
            steps,
            'E2E Signup Flow Test'
        );

        // Save reports
        await agent.saveReport(report);
        await agent.exportReportHTML(report);

        // Check results
        if (report.overallStatus === 'passed') {
            console.log('All tests passed!');
        } else {
            console.log(`Tests failed: ${report.steps.filter(s => s.status === 'failed').length} failures`);
        }

        return report;

    } finally {
        // Always cleanup
        await agent.cleanup();
    }
}

/**
 * Example 2: Responsive Design Testing
 */
export async function exampleResponsiveDesignTest() {
    const viewports = [
        { name: 'Mobile', size: { width: 375, height: 667 } },
        { name: 'Tablet', size: { width: 768, height: 1024 } },
        { name: 'Desktop', size: { width: 1280, height: 720 } }
    ];

    for (const viewport of viewports) {
        const agent = new BrowserSubAgent();

        try {
            await agent.initialize({
                headless: true,
                viewport: viewport.size
            });

            const steps: BrowserTestStep[] = [
                {
                    action: 'navigate',
                    target: 'https://example.com',
                    description: `Navigate on ${viewport.name}`
                },
                {
                    action: 'assert_element',
                    target: '.navbar',
                    description: 'Navigation bar is visible'
                },
                {
                    action: 'screenshot',
                    target: `${viewport.name.toLowerCase()}-viewport`,
                    description: `Full page screenshot on ${viewport.name}`
                },
                {
                    action: 'scroll',
                    target: 'html',
                    description: 'Scroll to bottom'
                },
                {
                    action: 'screenshot',
                    target: `${viewport.name.toLowerCase()}-footer`,
                    description: `Footer screenshot on ${viewport.name}`
                }
            ];

            const report = await agent.runTestFlow(
                'responsive-test',
                'https://example.com',
                steps,
                `Responsive Design Test - ${viewport.name}`
            );

            await agent.exportReportHTML(report);

        } finally {
            await agent.cleanup();
        }
    }
}

/**
 * Example 3: Form Validation Testing
 */
export async function exampleFormValidationTest() {
    const agent = new BrowserSubAgent();

    try {
        await agent.initialize({
            headless: true,
            viewport: { width: 1280, height: 720 }
        });

        const steps: BrowserTestStep[] = [
            {
                action: 'navigate',
                target: 'https://example.com/contact',
                description: 'Navigate to contact form'
            },
            // Test empty submission
            {
                action: 'click',
                target: 'button[type="submit"]',
                description: 'Submit empty form'
            },
            {
                action: 'wait',
                value: '1000',
                description: 'Wait for validation'
            },
            {
                action: 'assert_element',
                target: '.form-error',
                description: 'Error message appears'
            },
            // Test invalid email
            {
                action: 'fill',
                target: 'input[name="email"]',
                value: 'invalid-email',
                description: 'Enter invalid email'
            },
            {
                action: 'click',
                target: 'button[type="submit"]',
                description: 'Submit with invalid email'
            },
            {
                action: 'wait',
                value: '1000',
                description: 'Wait for validation'
            },
            {
                action: 'assert_text',
                target: '.email-error',
                value: 'invalid',
                description: 'Email validation error shown'
            },
            // Test valid submission
            {
                action: 'fill',
                target: 'input[name="email"]',
                value: 'valid@example.com',
                description: 'Enter valid email'
            },
            {
                action: 'fill',
                target: 'input[name="message"]',
                value: 'Test message',
                description: 'Enter message'
            },
            {
                action: 'click',
                target: 'button[type="submit"]',
                description: 'Submit valid form'
            },
            {
                action: 'wait',
                value: '2000',
                description: 'Wait for submission'
            },
            {
                action: 'assert_text',
                target: '.success-message',
                value: 'Thank you',
                description: 'Success message displayed'
            }
        ];

        const report = await agent.runTestFlow(
            'form-validation-agent',
            'https://example.com/contact',
            steps,
            'Form Validation Test Suite'
        );

        await agent.saveReport(report);
        await agent.exportReportHTML(report);

        return report;

    } finally {
        await agent.cleanup();
    }
}

/**
 * Example 4: Dynamic Content Loading Test
 */
export async function exampleDynamicContentTest() {
    const agent = new BrowserSubAgent();

    try {
        await agent.initialize({
            headless: true,
            viewport: { width: 1280, height: 720 }
        });

        const steps: BrowserTestStep[] = [
            {
                action: 'navigate',
                target: 'https://example.com/products',
                description: 'Navigate to products page'
            },
            {
                action: 'wait',
                value: '2000',
                description: 'Wait for initial load'
            },
            {
                action: 'assert_element',
                target: '.product-list',
                description: 'Product list is visible'
            },
            {
                action: 'screenshot',
                target: 'products-initial',
                description: 'Screenshot initial state'
            },
            {
                action: 'scroll',
                target: '.product-list',
                description: 'Scroll to load more products'
            },
            {
                action: 'waitForNetworkIdle' as any, // Custom wait
                description: 'Wait for network to stabilize'
            },
            {
                action: 'screenshot',
                target: 'products-scrolled',
                description: 'Screenshot after scroll'
            },
            {
                action: 'click',
                target: '.filter-btn',
                description: 'Click filter button'
            },
            {
                action: 'wait',
                value: '1500',
                description: 'Wait for filter to apply'
            },
            {
                action: 'assert_element',
                target: '.product-item',
                description: 'Filtered products are visible'
            }
        ];

        const report = await agent.runTestFlow(
            'dynamic-content-agent',
            'https://example.com/products',
            steps,
            'Dynamic Content Loading Test'
        );

        await agent.exportReportHTML(report);

        return report;

    } finally {
        await agent.cleanup();
    }
}

/**
 * Example 5: Performance Monitoring Test
 */
export async function examplePerformanceTest() {
    const agent = new BrowserSubAgent();

    try {
        await agent.initialize({
            headless: true,
            viewport: { width: 1280, height: 720 },
            recordVideo: true, // Record for analysis
            recordTrace: true  // Record detailed trace
        });

        const steps: BrowserTestStep[] = [
            {
                action: 'navigate',
                target: 'https://example.com',
                description: 'Navigate to homepage (measure load time)',
                timeout: 15000
            },
            {
                action: 'wait',
                value: '1000',
                description: 'Wait for all resources to load'
            },
            {
                action: 'screenshot',
                target: 'performance-check',
                description: 'Screenshot for visual regression'
            },
            {
                action: 'click',
                target: 'a[href="/expensive-operation"]',
                description: 'Trigger expensive operation'
            },
            {
                action: 'wait',
                value: '3000',
                description: 'Wait for operation to complete'
            },
            {
                action: 'assert_element',
                target: '.loading-complete',
                description: 'Operation completed'
            }
        ];

        const report = await agent.runTestFlow(
            'performance-agent',
            'https://example.com',
            steps,
            'Performance Test Suite'
        );

        console.log(`Total test duration: ${report.totalDuration}ms`);
        report.steps.forEach((step, i) => {
            console.log(`  Step ${i + 1}: ${step.duration}ms`);
        });

        await agent.exportReportHTML(report);

        return report;

    } finally {
        await agent.cleanup();
    }
}

/**
 * Example 6: Event Listener for Progressive Updates
 */
export async function exampleEventListeners() {
    const agent = new BrowserSubAgent();

    // Listen to step completion events
    agent.onStepComplete(({ stepIndex, result }) => {
        if (result.status === 'failed') {
            console.error(`Step ${stepIndex + 1} FAILED: ${result.error}`);
        } else {
            console.log(`Step ${stepIndex + 1} ${result.status.toUpperCase()} (${result.duration}ms)`);
        }
    });

    // Listen to test completion
    agent.onTestComplete(({ report }) => {
        console.log(`\nTest "${report.title}" completed with status: ${report.overallStatus}`);
        console.log(`  Total Duration: ${report.totalDuration}ms`);
        console.log(`  Screenshots: ${report.screenshots.length}`);
        console.log(`  Console Errors: ${report.consoleErrors.length}`);
        console.log(`  Network Errors: ${report.networkErrors.length}`);
    });

    try {
        await agent.initialize({
            headless: true,
            viewport: { width: 1280, height: 720 }
        });

        const steps: BrowserTestStep[] = [
            {
                action: 'navigate',
                target: 'https://example.com',
                description: 'Navigate'
            },
            {
                action: 'assert_element',
                target: 'h1',
                description: 'Check heading'
            }
        ];

        const report = await agent.runTestFlow(
            'event-listener-agent',
            'https://example.com',
            steps,
            'Event Listener Demo'
        );

        return report;

    } finally {
        await agent.cleanup();
    }
}

/**
 * Example 7: Parallel Test Execution
 */
export async function exampleParallelTests() {
    const testConfigs = [
        {
            url: 'https://example.com',
            title: 'Homepage Test',
            steps: [
                {
                    action: 'navigate',
                    target: 'https://example.com',
                    description: 'Navigate'
                },
                {
                    action: 'assert_element',
                    target: 'h1',
                    description: 'Check heading'
                }
            ] as BrowserTestStep[]
        },
        {
            url: 'https://example.com/about',
            title: 'About Page Test',
            steps: [
                {
                    action: 'navigate',
                    target: 'https://example.com/about',
                    description: 'Navigate to about'
                },
                {
                    action: 'assert_element',
                    target: '.team-section',
                    description: 'Check team section'
                }
            ] as BrowserTestStep[]
        }
    ];

    // Run tests in parallel
    const results = await Promise.all(
        testConfigs.map(async (config) => {
            const agent = new BrowserSubAgent();
            try {
                await agent.initialize({
                    headless: true,
                    viewport: { width: 1280, height: 720 }
                });

                return await agent.runTestFlow(
                    `parallel-agent-${config.title}`,
                    config.url,
                    config.steps,
                    config.title
                );
            } finally {
                await agent.cleanup();
            }
        })
    );

    return results;
}
