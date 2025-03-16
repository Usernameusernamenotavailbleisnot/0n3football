/**
 * Ultra-simplified API Client
 *
 * Direct and simple API client with no complexity
 */

const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { retry } = require('../utils/retry');
const config = require('../config');

class ApiClient {
  /**
   * Create simple API client
   * @param {Object} options - Options
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.proxyConfig = options.proxyConfig || null;
    this.token = null;
    this.privyIdToken = null;
    
    this.logger.debug('API client initialized');
  }
  
  /**
   * Set authentication tokens
   * @param {string} token - Main token
   * @param {string} privyIdToken - Privy ID token
   */
  setTokens(token, privyIdToken) {
    this.token = token;
    this.privyIdToken = privyIdToken;
  }
  
  /**
   * Create an agent with proxy if configured
   * @returns {Object|null} - Agent or null
   */
  createProxyAgent() {
    if (!this.proxyConfig) return null;
    
    const { host, port, username, password } = this.proxyConfig;
    if (!host || !port) return null;
    
    const auth = username && password ? `${username}:${password}@` : '';
    const proxyUrl = `http://${auth}${host}:${port}`;
    
    try {
      return new HttpsProxyAgent(proxyUrl);
    } catch (err) {
      this.logger.error('Failed to create proxy agent', { error: err.message });
      return null;
    }
  }
  
  /**
   * Make a GraphQL request
   * @param {string} operation - Operation name
   * @param {string} query - GraphQL query
   * @param {Object} variables - Variables
   * @returns {Promise} - API response
   */
  async graphqlRequest(operation, query, variables) {
    const agent = this.createProxyAgent();
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': config.USER_AGENT,
      'Origin': 'https://ofc.onefootball.com',
      'Referer': 'https://ofc.onefootball.com/'
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    if (this.privyIdToken) {
      headers['privy-id-token'] = this.privyIdToken;
    }
    
    return retry(
      async () => {
        return axios.post(config.BASE_URL, {
          operationName: operation,
          query,
          variables
        }, {
          headers,
          ...(agent ? { 
            httpsAgent: agent,
            proxy: false
          } : {})
        });
      },
      { 
        retries: 5,
        delay: 3000,
        logger: this.logger
      }
    );
  }
  
  /**
   * Make a request to Privy API
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request data
   * @returns {Promise} - API response
   */
  async privyRequest(endpoint, data) {
    const agent = this.createProxyAgent();
    const url = `${config.PRIVY_AUTH_URL}${endpoint}`;
    
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': config.USER_AGENT,
      'Origin': 'https://ofc.onefootball.com',
      'Referer': 'https://ofc.onefootball.com/',
      'Privy-App-Id': config.PRIVY_APP_ID,
      'Privy-Client': config.PRIVY_CLIENT
    };
    
    return retry(
      async () => {
        return axios.post(url, data, {
          headers,
          ...(agent ? { 
            httpsAgent: agent,
            proxy: false
          } : {})
        });
      },
      { 
        retries: 5,
        delay: 3000,
        logger: this.logger
      }
    );
  }
}

module.exports = ApiClient;
