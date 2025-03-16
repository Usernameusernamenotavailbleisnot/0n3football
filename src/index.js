#!/usr/bin/env node
/**
 * OFC Multi-Account Automation
 * 
 * Main application entry point that:
 * - Handles command line arguments
 * - Initializes components
 * - Starts automation process
 */

const config = require('./config');
const { createLogger } = require('./config/logger');
const TaskProcessor = require('./task-processor');
const TaskScheduler = require('./scheduler');

// Create logger
const logger = createLogger('ofc-automation', 'info');

/**
 * Parses command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    runOnce: args.includes('--run-once') || args.includes('-r'),
    help: args.includes('--help') || args.includes('-h'),
    interval: config.INTERVAL_HOURS
  };
  
  // Parse --interval or -i argument
  const intervalIndex = args.findIndex(arg => arg === '--interval' || arg === '-i');
  if (intervalIndex !== -1 && args[intervalIndex + 1]) {
    const interval = parseFloat(args[intervalIndex + 1]);
    if (!isNaN(interval) && interval > 0) {
      options.interval = interval;
    }
  }
  
  return options;
}

/**
 * Displays help message
 */
function showHelp() {
  console.log(`
OFC Multi-Account Automation

Usage:
  node index.js [options]

Options:
  -r, --run-once         Run tasks once and exit
  -i, --interval HOURS   Set interval between runs (default: ${config.INTERVAL_HOURS}h)
  -h, --help             Show this help message
  `);
}

/**
 * Main application entry point
 */
async function main() {
  // Parse command line arguments
  const args = parseArgs();
  
  // Show help and exit if requested
  if (args.help) {
    showHelp();
    return;
  }
  
  try {
    logger.info('Starting OFC Multi-Account Automation');
    
    // Create task processor
    const processor = new TaskProcessor({ logger });
    
    // Run once mode
    if (args.runOnce) {
      logger.info('Running in single execution mode');
      await processor.processAllWallets();
      logger.info('Execution completed');
      return;
    }
    
    // Create task scheduler
    const scheduler = new TaskScheduler({
      logger,
      processor: () => processor.processAllWallets(),
      intervalHours: args.interval
    });
    
    // Handle process signals
    process.on('SIGINT', () => {
      logger.info('Received SIGINT signal, shutting down...');
      scheduler.stop();
      setTimeout(() => process.exit(0), 1000);
    });
    
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM signal, shutting down...');
      scheduler.stop();
      setTimeout(() => process.exit(0), 1000);
    });
    
    // Start scheduler
    await scheduler.start();
    
    logger.info(`Scheduler running with ${args.interval}-hour interval`);
  } catch (error) {
    logger.error('Fatal error in application', { 
      error: error.message,
      stack: error.stack 
    });
    process.exit(1);
  }
}

// Run main function
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { main };