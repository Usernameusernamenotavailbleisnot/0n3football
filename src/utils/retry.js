/**
 * Retry Mechanism Utilities
 * 
 * Provides functions for operation retries with configurable:
 * - Maximum retry attempts
 * - Delay between retries
 * - Exponential backoff
 * - Success/failure hooks
 */

/**
 * Sleep/delay utility
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after delay
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Executes an operation with retry logic
   * 
   * @param {Function} operation - Async function to execute with retries
   * @param {Object} options - Retry options
   * @param {number} options.maxRetries - Maximum number of retry attempts
   * @param {number} options.retryDelay - Base delay between retries in ms
   * @param {boolean} options.exponentialBackoff - Whether to use exponential backoff
   * @param {Function} options.onRetry - Hook called before each retry attempt
   * @param {Function} options.logger - Logger instance
   * @returns {Promise} Result of the operation
   */
  async function withRetry(operation, options = {}) {
    const {
      maxRetries = 10,
      retryDelay = 5000,
      exponentialBackoff = true,
      onRetry = null,
      logger = console
    } = options;
  
    let lastError = null;
  
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        
        // Log failure
        const errorMsg = `${error.message} (${error.code || 'NO_CODE'})`;
        logger.warn(`Attempt ${attempt + 1}/${maxRetries} failed: ${errorMsg}`, {
          attempt: attempt + 1,
          maxRetries,
          errorMessage: errorMsg,
          responseStatus: error.response?.status
        });
  
        // Check if this was the last attempt
        if (attempt === maxRetries - 1) {
          logger.error('Operation failed after maximum retries', { 
            error,
            attempts: maxRetries
          });
          throw error;
        }
        
        // Calculate delay for next attempt (with exponential backoff if enabled)
        const delay = exponentialBackoff 
          ? retryDelay * Math.pow(2, attempt)
          : retryDelay;
        
        // Call the onRetry hook if provided
        if (onRetry && typeof onRetry === 'function') {
          try {
            await onRetry(attempt, error, delay);
          } catch (hookError) {
            logger.warn('Error in retry hook', { error: hookError.message });
          }
        }
        
        logger.info(`Retrying in ${delay/1000} seconds...`);
        await sleep(delay);
      }
    }
    
    // This code should not be reached due to the final throw above,
    // but is included for safety
    throw lastError;
  }
  
  module.exports = {
    sleep,
    withRetry
  };