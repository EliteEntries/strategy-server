#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_RESTARTS = 10;
const BASE_RESTART_DELAY_MS = 2000;
const MAX_RESTART_DELAY_MS = 60000;
const CRASH_WINDOW_MS = 300000; // 5 minutes

let child = null;
let restartCount = 0;
let crashTimes = [];
let isShuttingDown = false;

function log(level, message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  console.log(logMessage);
  
  // Append to log file
  const logDir = path.join(__dirname, '../logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const logFile = path.join(logDir, 'start.log');
  fs.appendFileSync(logFile, logMessage + '\n');
}

function getRestartDelay() {
  // Exponential backoff with max cap
  const delay = Math.min(
    BASE_RESTART_DELAY_MS * Math.pow(2, restartCount),
    MAX_RESTART_DELAY_MS
  );
  return delay;
}

function cleanupOldCrashes() {
  const now = Date.now();
  crashTimes = crashTimes.filter(time => now - time < CRASH_WINDOW_MS);
}

function start() {
  if (isShuttingDown) {
    log('info', 'Shutdown in progress, not starting new process');
    return;
  }

  cleanupOldCrashes();

  if (crashTimes.length >= MAX_RESTARTS) {
    log('error', `Too many crashes (${crashTimes.length}) within ${CRASH_WINDOW_MS / 1000}s. Exiting.`);
    process.exit(1);
  }

  log('info', `Starting server: node dist/index.js (restart count: ${restartCount})`);
  
  child = spawn('node', ['dist/index.js'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' }
  });

  const startTime = Date.now();

  child.on('exit', (code, signal) => {
    const uptime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (isShuttingDown) {
      log('info', 'Process exited during shutdown');
      return;
    }

    if (signal) {
      log('warn', `Process terminated by signal ${signal} after ${uptime}s`);
      gracefulShutdown(1);
      return;
    }

    if (code === 0) {
      log('info', `Process exited cleanly with code 0 after ${uptime}s`);
      process.exit(0);
    }

    // Track crash
    crashTimes.push(Date.now());
    restartCount++;

    const delay = getRestartDelay();
    log('error', `Process crashed with code ${code} after ${uptime}s. Restarting in ${delay / 1000}s... (attempt ${restartCount})`);
    
    setTimeout(start, delay);
  });

  child.on('error', (err) => {
    log('error', `Process spawn error: ${err.message}`);
    crashTimes.push(Date.now());
    restartCount++;
    
    const delay = getRestartDelay();
    log('info', `Restarting in ${delay / 1000}s...`);
    setTimeout(start, delay);
  });

  // Reset restart count on successful long run
  setTimeout(() => {
    if (!isShuttingDown && child && !child.killed) {
      restartCount = 0;
      log('info', 'Process running stable, reset restart count');
    }
  }, 60000); // 1 minute of uptime = success
}

function gracefulShutdown(exitCode = 0) {
  if (isShuttingDown) return;
  
  isShuttingDown = true;
  log('info', 'Initiating graceful shutdown...');

  if (child && !child.killed) {
    log('info', 'Sending SIGTERM to child process...');
    child.kill('SIGTERM');

    // Force kill after 30 seconds
    setTimeout(() => {
      if (child && !child.killed) {
        log('warn', 'Force killing child process (timeout exceeded)');
        child.kill('SIGKILL');
      }
      process.exit(exitCode);
    }, 30000);
  } else {
    process.exit(exitCode);
  }
}

// Signal handlers
process.on('SIGINT', () => {
  log('info', 'Received SIGINT');
  gracefulShutdown(0);
});

process.on('SIGTERM', () => {
  log('info', 'Received SIGTERM');
  gracefulShutdown(0);
});

process.on('uncaughtException', (err) => {
  log('error', `Uncaught exception in supervisor: ${err.stack}`);
  gracefulShutdown(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log('error', `Unhandled rejection in supervisor: ${reason}`);
  gracefulShutdown(1);
});

// Health check endpoint (optional - could be extended)
log('info', '=== Strategy Server Supervisor Starting ===');
log('info', `Environment: ${process.env.NODE_ENV || 'production'}`);
log('info', `Max restarts in window: ${MAX_RESTARTS} within ${CRASH_WINDOW_MS / 1000}s`);

start();
