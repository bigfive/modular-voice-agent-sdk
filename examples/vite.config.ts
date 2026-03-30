import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: __dirname,
  server: {
    port: 5173,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      input: {
        'example-1': resolve(__dirname, 'example-1-speech-browser-speech/index.html'),
        'example-2': resolve(__dirname, 'example-2-browser-browser-speech/index.html'),
        'example-3': resolve(__dirname, 'example-3-transformers-transformers-transformers/index.html'),
        'example-4': resolve(__dirname, 'example-4-native-native-native/index.html'),
        'example-5': resolve(__dirname, 'example-5-speech-native-speech/index.html'),
        'example-6': resolve(__dirname, 'example-6-transformers-transformers-speech/index.html'),
        'example-7': resolve(__dirname, 'example-7-native-transformers-speech/index.html'),
        'example-12': resolve(__dirname, 'example-12-ui-demo/index.html'),
        'example-13': resolve(__dirname, 'example-13-browser-agent-speech/index.html'),
      },
    },
  },
});
