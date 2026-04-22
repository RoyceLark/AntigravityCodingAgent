import axios from 'axios';

export const WebSearchTools = {
    searchWeb: {
        name: 'search_web',
        description: 'Performs a web search for a given query. Returns a summary of relevant information along with URL citations.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The search query' },
                domain: { type: 'string', description: 'Optional domain to prioritize in search results' }
            },
            required: ['query']
        },
        execute: async (args: { query: string, domain?: string }) => {
            try {
                // Using DuckDuckGo Instant Answer API (free, no API key required)
                const searchQuery = args.domain ? `site:${args.domain} ${args.query}` : args.query;
                const encodedQuery = encodeURIComponent(searchQuery);

                // DuckDuckGo Instant Answer API
                const ddgUrl = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;
                const response = await axios.get(ddgUrl, { timeout: 10000 });

                const data = response.data;
                let results: string[] = [];

                // Abstract (main answer)
                if (data.Abstract) {
                    results.push(`**Summary:** ${data.Abstract}`);
                    if (data.AbstractURL) {
                        results.push(`**Source:** ${data.AbstractURL}`);
                    }
                }

                // Related topics
                if (data.RelatedTopics && data.RelatedTopics.length > 0) {
                    results.push('\n**Related Information:**');
                    data.RelatedTopics.slice(0, 5).forEach((topic: any, idx: number) => {
                        if (topic.Text && topic.FirstURL) {
                            results.push(`${idx + 1}. ${topic.Text}`);
                            results.push(`   Source: ${topic.FirstURL}`);
                        }
                    });
                }

                // Infobox
                if (data.Infobox && data.Infobox.content) {
                    results.push('\n**Additional Details:**');
                    data.Infobox.content.slice(0, 3).forEach((item: any) => {
                        if (item.label && item.value) {
                            results.push(`- ${item.label}: ${item.value}`);
                        }
                    });
                }

                if (results.length === 0) {
                    // Fallback: provide search URL
                    const googleSearchUrl = `https://www.google.com/search?q=${encodedQuery}`;
                    return `No instant results found. You can search manually at: ${googleSearchUrl}\n\nQuery: "${args.query}"`;
                }

                return results.join('\n');
            } catch (error: any) {
                return `Web search failed: ${error.message}. Query was: "${args.query}"`;
            }
        }
    },

    readUrlContent: {
        name: 'read_url_content',
        description: 'Fetch content from a URL via HTTP request. Supports HTML (converted to markdown) and plain text.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL to read content from' }
            },
            required: ['url']
        },
        execute: async (args: { url: string }) => {
            try {
                const response = await axios.get(args.url, {
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    maxContentLength: 5 * 1024 * 1024 // 5MB limit
                });

                const contentType = response.headers['content-type'] || '';

                if (contentType.includes('text/html')) {
                    // Convert HTML to markdown using turndown
                    const TurndownService = require('turndown');
                    const turndownService = new TurndownService({
                        headingStyle: 'atx',
                        codeBlockStyle: 'fenced'
                    });
                    const markdown = turndownService.turndown(response.data);

                    // Truncate if too long
                    if (markdown.length > 50000) {
                        return markdown.substring(0, 50000) + '\n\n[Content truncated due to length...]';
                    }
                    return markdown;
                } else {
                    // Plain text or other
                    const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);
                    if (text.length > 50000) {
                        return text.substring(0, 50000) + '\n\n[Content truncated due to length...]';
                    }
                    return text;
                }
            } catch (error: any) {
                return `Failed to read URL: ${error.message}`;
            }
        }
    }
};
