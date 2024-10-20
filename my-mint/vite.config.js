import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import wasm from "vite-plugin-wasm";
import { readFileSync } from 'fs';
import topLevelAwait from "vite-plugin-top-level-await";

import nodePolyfills from 'vite-plugin-node-stdlib-browser'

const packageId = readFileSync('../client-scripts/package.id', 'utf8').trim();
//const questIds = readFileSync('../client-scripts/quest.ids', 'utf-8').split('\n').map(line => line.trim());
const gameId = readFileSync('../client-scripts/game.id', 'utf8').trim();
const gameIdMainnet = readFileSync('../client-scripts/game.id_mainnet', 'utf8').trim();

import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({

  plugins: [react(), wasm(), topLevelAwait(), nodePolyfills()],
  resolve: {
    alias: {
      'ffjavascript': path.join(__dirname, 'node_modules/ffjavascript'),
      'js-sha3': path.join(__dirname, 'node_modules/js-sha3'),
    },
  },
  build: {
    //target: 'esnext',
    minify: false
  },
  //
  //dsad
  //
  // build: {
  //   rollupOptions: {
  //     external: [
  //       "js-sha3",
  //       "ffjavascript",
  //     ],
  //   },
  // },
  // optimizeDeps: {
  //   include: ['./src/snarkjs.js'],
  // },
  define: {
    // process: { browser: true },
    'process.env.packageId': JSON.stringify(packageId),
    //'process.env.questIds': JSON.stringify(questIds),
    'process.env.gameId': JSON.stringify(gameId),
    'process.env.gameIdMainnet': JSON.stringify(gameIdMainnet)
  },
})
