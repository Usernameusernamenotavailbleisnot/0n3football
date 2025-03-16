/**
 * Authentication Service
 * 
 * Handles authentication with the OFC platform including:
 * - SIWE (Sign-In With Ethereum) authentication
 * - Privy authentication
 * - Token management
 */

const ethers = require('ethers');
const ApiClient = require('./api-client');
const config = require('../config');

class AuthService {
  /**
   * Creates a new authentication service
   * @param {Object} options - Service options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.wallet - Ethers.js wallet instance
   * @param {Object} options.proxyConfig - Optional proxy configuration
   */
  constructor(options = {}) {
    const { logger = console, wallet, proxyConfig = null } = options;
    
    if (!wallet) {
      throw new Error('Wallet is required for authentication');
    }
    
    this.logger = logger;
    this.wallet = wallet;
    this.apiClient = new ApiClient({ logger, proxyConfig });
  }
  
  /**
   * Gets a nonce for SIWE authentication
   * @returns {Promise<string>} Authentication nonce
   */
  async getNonce() {
    this.logger.debug('Getting authentication nonce');
    
    const response = await this.apiClient.privyRequest('/init', {
      address: this.wallet.address
    });
    
    return response.data.nonce;
  }
  
  /**
   * Performs full authentication flow
   * @returns {Promise<Object>} Authentication result with tokens
   */
  async login() {
    try {
      this.logger.info(`Starting authentication for wallet: ${this.wallet.address}`);
      
      // Step 1: Get authentication nonce
      const nonce = await this.getNonce();
      const timestamp = new Date().toISOString();
      
      // Step 2: Create SIWE message
      const message = this.createSiweMessage(nonce, timestamp);
      this.logger.debug('Created SIWE message', { message });
      
      // Step 3: Sign the message
      const signature = await this.wallet.signMessage(message);
      this.logger.info('Message signed successfully');
      
      // Step 4: Authenticate with Privy
      const privyResponse = await this.authenticateWithPrivy(message, signature);
      const privyToken = privyResponse.data.token;
      const privyIdToken = privyResponse.data.identity_token;
      
      this.logger.info('Privy authentication successful');
      
      // Step 5: Login to Deform with Privy token
      const deformResponse = await this.loginToDeform(privyToken);
      const deformToken = deformResponse.data.data.userLogin;
      
      this.logger.info('Deform authentication successful');
      
      // Step 6: Set tokens on API client
      this.apiClient.setTokens(deformToken, privyIdToken);
      
      return {
        wallet: this.wallet.address,
        privyToken,
        privyIdToken,
        deformToken,
        apiClient: this.apiClient
      };
    } catch (error) {
      this.logger.error('Authentication failed', {
        wallet: this.wallet.address,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Creates a SIWE message
   * @param {string} nonce - Authentication nonce
   * @param {string} timestamp - ISO timestamp
   * @returns {string} SIWE message
   */
  createSiweMessage(nonce, timestamp) {
    return `ofc.onefootball.com wants you to sign in with your Ethereum account:
${this.wallet.address}

By signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.

URI: https://ofc.onefootball.com
Version: 1
Chain ID: 1
Nonce: ${nonce}
Issued At: ${timestamp}
Resources:
- https://privy.io`;
  }
  
  /**
   * Authenticates with Privy service
   * @param {string} message - SIWE message
   * @param {string} signature - Message signature
   * @returns {Promise<Object>} Privy authentication response
   */
  async authenticateWithPrivy(message, signature) {
    return await this.apiClient.privyRequest('/authenticate', {
      message,
      signature,
      chainId: "eip155:1",
      walletClientType: "rabby_wallet",
      connectorType: "injected",
      mode: "login-or-sign-up"
    });
  }
  
  /**
   * Logs in to Deform with Privy token
   * @param {string} privyToken - Privy authentication token
   * @returns {Promise<Object>} Deform login response
   */
  async loginToDeform(privyToken) {
    const loginMutation = `mutation UserLogin($data: UserLoginInput!) {
      userLogin(data: $data)
    }`;
    
    return await this.apiClient.graphqlRequest(
      "UserLogin",
      loginMutation,
      {
        data: {
          externalAuthToken: privyToken
        }
      }
    );
  }
}

module.exports = AuthService;