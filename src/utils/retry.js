/**
 * Simplified Retry Utility
 * 
 * A simple and direct implementation for retrying operations
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
 * Simple retry function - no recursion to avoid stack overflow
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Options
 * @returns {Promise} - Result of the function
 */
async function retry(fn, options = {}) {
  const { 
    retries = 5,
    delay = 3000,
    logger = console,
    onRetry = null
  } = options;
  
  let lastError;
  
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryDelay = Math.min(delay * (i + 1), 15000); // Cap at 15 seconds
      
      logger.warn(`Attempt ${i + 1}/${retries} failed: ${err.message || 'Unknown error'}`, {
        attempt: i + 1,
        retries
      });
      
      if (i < retries - 1) {
        if (onRetry) {
          try {
            await onRetry(i, err);
          } catch (hookErr) {
            // Ignore errors in the retry hook
          }
        }
        
        logger.info(`Retrying in ${Math.round(retryDelay/1000)} seconds...`);
        await sleep(retryDelay);
      }
    }
  }
  
  throw lastError;
}

module.exports = {
  sleep,
  retry
};
