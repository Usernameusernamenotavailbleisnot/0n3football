/**
 * Proxy Management Utilities
 * 
 * Provides functions for:
 * - Parsing proxy configuration strings
 * - Creating proxy agents for HTTP requests
 * - Validating proxy configurations
 */

const { HttpsProxyAgent } = require('https-proxy-agent');

/**
 * Parses proxy configuration and creates proxy agent
 * @param {Object} proxyConfig - Proxy configuration object
 * @param {string} proxyConfig.host - Proxy host
 * @param {string|number} proxyConfig.port - Proxy port
 * @param {string} [proxyConfig.username] - Optional proxy username
 * @param {string} [proxyConfig.password] - Optional proxy password
 * @returns {Object|null} Proxy configuration with agent or null if invalid
 */
function parseProxy(proxyConfig) {
  if (!proxyConfig || !proxyConfig.host || !proxyConfig.port) return null;
  
  try {
    // Construct auth part if credentials provided
    const auth = proxyConfig.username && proxyConfig.password
      ? `${proxyConfig.username}:${proxyConfig.password}@`
      : '';
    
    // Construct full proxy URL
    const proxyUrl = `http://${auth}${proxyConfig.host}:${proxyConfig.port}`;
    
    return {
      proxyUrl,
      agent: new HttpsProxyAgent(proxyUrl),
      config: {
        host: proxyConfig.host,
        port: proxyConfig.port,
        username: proxyConfig.username || null,
        password: proxyConfig.password ? '********' : null
      }
    };
  } catch (error) {
    console.error('Proxy parsing error', error.message);
    return null;
  }
}

/**
 * Tests if a proxy is working by making a test request
 * @param {Object} proxyConfig - Proxy configuration
 * @param {Object} options - Test options
 * @param {Function} options.axios - Axios instance
 * @param {string} options.testUrl - URL to test proxy with
 * @param {Function} options.logger - Logger instance
 * @returns {Promise<boolean>} True if proxy is working
 */
async function testProxy(proxyConfig, options = {}) {
  const {
    axios = require('axios'),
    testUrl = 'https://api.ipify.org?format=json',
    logger = console
  } = options;

  const proxy = parseProxy(proxyConfig);
  if (!proxy) return false;

  try {
    const response = await axios.get(testUrl, {
      httpsAgent: proxy.agent,
      timeout: 10000 // 10 seconds timeout for test
    });

    logger.debug('Proxy test successful', {
      proxy: proxy.config,
      status: response.status,
      data: response.data
    });

    return true;
  } catch (error) {
    logger.warn('Proxy test failed', {
      proxy: proxy.config,
      error: error.message
    });
    return false;
  }
}

/**
 * Configures an axios instance with proxy settings
 * @param {Object} axiosConfig - Axios configuration object
 * @param {Object} proxyConfig - Proxy configuration
 * @param {Object} options - Options
 * @param {Function} options.logger - Logger instance
 * @returns {Object} Updated axios configuration
 */
function configureAxiosWithProxy(axiosConfig, proxyConfig, options = {}) {
  const { logger = console } = options;
  
  if (!proxyConfig) return axiosConfig;
  
  const proxy = parseProxy(proxyConfig);
  if (!proxy) return axiosConfig;
  
  logger.debug('Configuring axios with proxy', {
    host: proxy.config.host,
    port: proxy.config.port
  });
  
  return {
    ...axiosConfig,
    httpsAgent: proxy.agent,
    httpAgent: proxy.agent,
    proxy: false // Disable axios's default proxy handling
  };
}

module.exports = {
  parseProxy,
  testProxy,
  configureAxiosWithProxy
};