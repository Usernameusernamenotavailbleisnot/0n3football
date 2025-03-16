/**
 * Proxy Management Utilities
 * 
 * Simple and direct implementation for HTTP/HTTPS proxy support
 */

const { HttpsProxyAgent } = require('https-proxy-agent');

/**
 * Creates a proxy configuration object for axios
 * @param {Object} proxyConfig - Proxy configuration 
 * @param {string} proxyConfig.host - Proxy host
 * @param {string|number} proxyConfig.port - Proxy port
 * @param {string} [proxyConfig.username] - Proxy username
 * @param {string} [proxyConfig.password] - Proxy password
 * @param {Object} options - Additional options
 * @param {Function} options.logger - Logger instance
 * @returns {Object} Axios configuration with proxy
 */
function configureAxiosWithProxy(axiosConfig, proxyConfig, options = {}) {
  const { logger = console } = options;
  
  if (!proxyConfig || !proxyConfig.host || !proxyConfig.port) {
    return axiosConfig;
  }
  
  try {
    // Format proxy URL
    const auth = proxyConfig.username && proxyConfig.password
      ? `${proxyConfig.username}:${proxyConfig.password}@`
      : '';
    
    const proxyUrl = `http://${auth}${proxyConfig.host}:${proxyConfig.port}`;
    
    logger.debug(`Configuring proxy: ${proxyConfig.host}:${proxyConfig.port}`);
    
    // Simple and direct proxy configuration
    return {
      ...axiosConfig,
      proxy: false, // Disable axios's default proxy handling
      httpAgent: new HttpsProxyAgent(proxyUrl),
      httpsAgent: new HttpsProxyAgent(proxyUrl)
    };
  } catch (error) {
    logger.error('Error configuring proxy', { 
      error: error.message,
      host: proxyConfig.host,
      port: proxyConfig.port
    });
    return axiosConfig; // Return original config if proxy setup fails
  }
}

/**
 * Gets a formatted display string for a proxy
 * @param {Object} proxyConfig - Proxy configuration
 * @returns {string} Formatted proxy string
 */
function getProxyDisplayString(proxyConfig) {
  if (!proxyConfig || !proxyConfig.host || !proxyConfig.port) {
    return 'No proxy';
  }
  
  const hasAuth = Boolean(proxyConfig.username && proxyConfig.password);
  return `${proxyConfig.host}:${proxyConfig.port}${hasAuth ? ' (with auth)' : ''}`;
}

module.exports = {
  configureAxiosWithProxy,
  getProxyDisplayString
};
