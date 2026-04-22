import axios from 'axios';
import TurndownService from 'turndown';

export const URLTools = {
    readUrlContent: {
        name: 'read_url_content',
        description: 'Fetch content from a URL via HTTP (faster than browser for static pages)',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The URL to fetch' }
            },
            required: ['url']
        },
        execute: async (args: { url: string }) => {
            try {
                const response = await axios.get(args.url);
                const html = response.data;
                const turndownService = new TurndownService();
                const markdown = turndownService.turndown(html);
                return markdown.substring(0, 10000); // 10k character limit
            } catch (error: any) {
                return `Error fetching URL: ${error.message}`;
            }
        }
    }
};
