#!/usr/bin/env node
const { spawn } = require('child_process');

const RESTART_DELAY_MS = 5000;

let child = null;

function start() {
  console.log('Starting server: node dist/index.js');
  child = spawn('node', ['dist/index.js'], { stdio: 'inherit' });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`Child terminated by signal ${signal}. Exiting.`);
      process.exit(1);
    }

    if (code === 0) {
      console.log('Child exited with code 0. Not restarting.');
      process.exit(0);
    }

    console.error(`Child exited with code ${code}. Restarting in ${RESTART_DELAY_MS / 1000}s...`);
    setTimeout(start, RESTART_DELAY_MS);
  });

  child.on('error', (err) => {
    console.error('Child process error:', err);
    console.error(`Restarting in ${RESTART_DELAY_MS / 1000}s...`);
    setTimeout(start, RESTART_DELAY_MS);
  });
}

process.on('SIGINT', () => {
  if (child) child.kill('SIGINT');
  process.exit();
});

process.on('SIGTERM', () => {
  if (child) child.kill('SIGTERM');
  process.exit();
});

start();
