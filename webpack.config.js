const path = require('path');

module.exports = {
    target: 'node',
    mode: 'none',
    entry: './src/extension.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: 'commonjs2'
    },
    externals: {
        'vscode': 'commonjs vscode',
        'playwright': 'commonjs playwright',
        'path': 'commonjs path',
        'fs': 'commonjs fs',
        'fs/promises': 'commonjs fs/promises',
        'util': 'commonjs util',
        'child_process': 'commonjs child_process',
        'os': 'commonjs os',
        'crypto': 'commonjs crypto'
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader'
                    }
                ]
            }
        ]
    },
    devtool: 'nosources-source-map',
    infrastructureLogging: {
        level: "log"
    }
};
