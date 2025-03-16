/**
 * Task Scheduler
 * 
 * Manages task scheduling with:
 * - Configurable intervals
 * - Status tracking
 * - Execution reporting
 */

const EventEmitter = require('events');
const config = require('./config');
const { sleep } = require('./utils/retry');

class TaskScheduler extends EventEmitter {
  /**
   * Creates a new task scheduler
   * @param {Object} options - Scheduler options
   * @param {Object} options.logger - Logger instance
   * @param {Function} options.processor - Task processor function
   * @param {number} options.intervalHours - Hours between runs
   */
  constructor(options = {}) {
    super();
    
    const {
      logger = console,
      processor,
      intervalHours = config.INTERVAL_HOURS
    } = options;
    
    if (!processor || typeof processor !== 'function') {
      throw new Error('Task processor function is required');
    }
    
    this.logger = logger;
    this.processor = processor;
    this.intervalHours = intervalHours;
    this.nextRunTime = null;
    this.running = false;
    this.countdownInterval = null;
  }
  
  /**
   * Calculates the next run time
   * @returns {Date} Next scheduled run time
   */
  calculateNextRunTime() {
    const now = new Date();
    return new Date(now.getTime() + (this.intervalHours * 60 * 60 * 1000));
  }
  
  /**
   * Formats time remaining in human-readable format
   * @param {number} milliseconds - Time in milliseconds
   * @returns {string} Formatted time string
   */
  formatTimeRemaining(milliseconds) {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  
  /**
   * Starts the task scheduler
   * @returns {Promise} Resolves when scheduler starts
   */
  async start() {
    if (this.running) {
      this.logger.warn('Scheduler is already running');
      return;
    }
    
    this.running = true;
    this.logger.info('Starting task scheduler');
    
    // Start first run immediately
    this.startCountdown(0);
    
    return this;
  }
  
  /**
   * Stops the task scheduler
   */
  stop() {
    this.running = false;
    
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    
    this.logger.info('Task scheduler stopped');
    this.emit('stopped');
  }
  
  /**
   * Starts countdown to next execution
   * @param {number} delay - Delay in milliseconds
   */
  startCountdown(delay = 0) {
    // Clear existing countdown if any
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    
    // Calculate next run time
    this.nextRunTime = delay === 0 
      ? new Date() // Immediate run
      : this.calculateNextRunTime();
    
    this.logger.info(`Next run scheduled for: ${this.nextRunTime.toLocaleString()}`);
    
    // Set up the execution
    setTimeout(async () => {
      await this.executeTaskProcessor();
      
      // Only schedule next run if still running
      if (this.running) {
        // Calculate interval for next run
        const interval = this.intervalHours * 60 * 60 * 1000;
        this.startCountdown(interval);
      }
    }, delay);
    
    // Set up countdown logging
    if (delay > 0) {
      this.startCountdownLogging();
    }
  }
  
  /**
   * Starts logging countdown to next run
   */
  startCountdownLogging() {
    // Log countdown once per minute
    this.countdownInterval = setInterval(() => {
      if (!this.running || !this.nextRunTime) {
        clearInterval(this.countdownInterval);
        return;
      }
      
      const now = new Date();
      const timeRemaining = this.nextRunTime.getTime() - now.getTime();
      
      if (timeRemaining <= 0) {
        clearInterval(this.countdownInterval);
        return;
      }
      
      const formattedTime = this.formatTimeRemaining(timeRemaining);
      this.logger.info(`Time until next run: ${formattedTime}`);
    }, 60000); // Update every minute
  }
  
  /**
   * Executes the task processor
   * @returns {Promise} Resolves when processor completes
   */
  async executeTaskProcessor() {
    this.logger.info('Starting task execution cycle');
    this.emit('executionStarted');
    
    try {
      const results = await this.processor();
      this.logger.info('Task execution completed successfully');
      this.emit('executionCompleted', results);
      return results;
    } catch (error) {
      this.logger.error('Error in task execution', { 
        error: error.message,
        stack: error.stack 
      });
      this.emit('executionFailed', error);
      return { error };
    }
  }
  
  /**
   * Runs the task processor once immediately
   * @returns {Promise} Resolves with execution results
   */
  async runOnce() {
    this.logger.info('Running task processor once');
    return await this.executeTaskProcessor();
  }
  
  /**
   * Returns current scheduler status
   * @returns {Object} Scheduler status
   */
  getStatus() {
    return {
      running: this.running,
      nextRunTime: this.nextRunTime,
      intervalHours: this.intervalHours,
      timeRemaining: this.nextRunTime
        ? this.formatTimeRemaining(Math.max(0, this.nextRunTime.getTime() - Date.now()))
        : null
    };
  }
}

module.exports = TaskScheduler;