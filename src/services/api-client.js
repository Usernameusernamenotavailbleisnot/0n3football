/**
 * API Client Service
 * 
 * Centralized API client that handles:
 * - Authentication
 * - Request/response interceptors
 * - Error handling and retries
 * - Proxy configuration
 */

const axios = require('axios');
const config = require('../config');
const { withRetry } = require('../utils/retry');
const { configureAxiosWithProxy } = require('../utils/proxy');

class ApiClient {
  /**
   * Creates a new API client instance
   * @param {Object} options - Client options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.proxyConfig - Optional proxy configuration
   */
  constructor(options = {}) {
    const { logger = console, proxyConfig = null } = options;
    
    this.logger = logger;
    this.proxyConfig = proxyConfig;
    this.token = null;
    this.privyIdToken = null;
    
    this.initialize();
  }
  
  /**
   * Initializes the API client with base configuration
   */
  initialize() {
    // Configure Axios instance
    const axiosConfig = {
      baseURL: config.BASE_URL,
      timeout: 30000, // 30 seconds timeout
      headers: {
        'User-Agent': config.USER_AGENT,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    // Apply proxy if configured
    const finalConfig = this.proxyConfig 
      ? configureAxiosWithProxy(axiosConfig, this.proxyConfig, { logger: this.logger }) 
      : axiosConfig;

    // Create Axios instance
    this.client = axios.create(finalConfig);

    // Add request and response interceptors
    this.addInterceptors();
  }
  
  /**
   * Adds request and response interceptors to the client
   */
  addInterceptors() {
    // Request interceptor
    this.client.interceptors.request.use(
      config => {
        this.logRequest(config);
        return config;
      },
      error => {
        this.logger.error('Request Interceptor Error', { 
          error: error.message,
          config: error.config
        });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      response => {
        this.logResponse(response);
        return response;
      },
      error => {
        this.logResponseError(error);
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * Logs API request details
   * @param {Object} config - Request configuration
   */
  logRequest(config) {
    this.logger.debug('API Request', {
      method: config.method?.toUpperCase(),
      url: config.url
      // Removed detailed headers and payload logging
    });
  }
  
  /**
   * Logs API response details
   * @param {Object} response - Response object
   */
  logResponse(response) {
    this.logger.debug('API Response', {
      status: response.status,
      statusText: response.statusText,
      size: response.headers['content-length'] || 'unknown',
      time: response.config?.metadata?.endTime - response.config?.metadata?.startTime
      // Removed detailed data logging
    });
  }
  
  /**
   * Logs API response error details
   * @param {Error} error - Error object
   */
  logResponseError(error) {
    const errorDetails = {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      method: error.config?.method,
      url: error.config?.url
    };

    this.logger.error('API Response Error', errorDetails);

    // Error handling for different status codes
    if (error.response) {
      switch (error.response.status) {
        case 401:
          this.logger.error('Unauthorized: Check your authentication token');
          break;
        case 403:
          this.logger.error('Forbidden: You may not have permission');
          break;
        case 404:
          this.logger.error('Not Found: The requested resource does not exist');
          break;
        case 429:
          this.logger.error('Too Many Requests: Rate limit exceeded');
          break;
        case 500:
          this.logger.error('Internal Server Error');
          break;
      }
    } else if (error.request) {
      this.logger.error('No response received', { 
        request: error.request 
      });
    } else {
      this.logger.error('Error setting up request', { 
        message: error.message 
      });
    }
  }
  
  /**
   * Sanitizes headers to remove sensitive information
   * @param {Object} headers - Request headers
   * @returns {Object} Sanitized headers
   */
  sanitizeHeaders(headers = {}) {
    if (!headers) return {};
    
    const sanitized = { ...headers };
    const sensitiveHeaders = ['authorization', 'privy-id-token', 'cookie'];
    
    Object.keys(sanitized).forEach(key => {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }
  
  /**
   * Sets authentication tokens
   * @param {string} token - Main authentication token
   * @param {string} privyIdToken - Privy ID token
   */
  setTokens(token, privyIdToken) {
    this.token = token;
    this.privyIdToken = privyIdToken;
  }
  
  /**
   * Gets request headers including authentication
   * @param {Object} additionalHeaders - Additional headers to include
   * @returns {Object} Headers object
   */
  getHeaders(additionalHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': config.USER_AGENT,
      ...additionalHeaders
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    if (this.privyIdToken) {
      headers['privy-id-token'] = this.privyIdToken;
    }
    
    return headers;
  }
  
  /**
   * Makes a request to the Privy authentication service
   * @param {string} endpoint - API endpoint (without base URL)
   * @param {Object} data - Request payload
   * @param {Object} options - Request options
   * @returns {Promise} API response
   */
  async privyRequest(endpoint, data = {}, options = {}) {
    const { headers = {}, method = 'POST' } = options;
    
    const requestConfig = {
      method,
      url: `${config.PRIVY_AUTH_URL}${endpoint}`,
      data,
      headers: {
        ...this.getHeaders(headers),
        'Origin': 'https://ofc.onefootball.com',
        'Referer': 'https://ofc.onefootball.com/',
        'Privy-App-Id': config.PRIVY_APP_ID,
        'Privy-Client': config.PRIVY_CLIENT
      }
    };
    
    return withRetry(
      async () => this.client(requestConfig),
      { 
        maxRetries: config.MAX_RETRIES,
        retryDelay: config.RETRY_DELAY,
        logger: this.logger 
      }
    );
  }
  
  /**
   * Makes a GraphQL request to the Deform API
   * @param {string} operationName - GraphQL operation name
   * @param {string} query - GraphQL query
   * @param {Object} variables - GraphQL variables
   * @param {Object} options - Request options
   * @returns {Promise} API response
   */
  async graphqlRequest(operationName, query, variables = {}, options = {}) {
    const { headers = {} } = options;
    
    const requestConfig = {
      method: 'POST',
      url: config.BASE_URL,
      data: {
        operationName,
        query,
        variables
      },
      headers: this.getHeaders({
        'Accept': '*/*',
        'Origin': 'https://ofc.onefootball.com',
        'Referer': 'https://ofc.onefootball.com/',
        ...headers
      })
    };
    
    return withRetry(
      async () => this.client(requestConfig),
      { 
        maxRetries: config.MAX_RETRIES,
        retryDelay: config.RETRY_DELAY,
        logger: this.logger 
      }
    );
  }
}

module.exports = ApiClient;