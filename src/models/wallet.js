/**
 * Wallet Model
 * 
 * Represents a wallet with:
 * - Ethereum wallet instance
 * - Associated proxy configuration
 * - Authentication state
 */

const ethers = require('ethers');

class Wallet {
  /**
   * Creates a new wallet model
   * @param {Object} options - Wallet options
   * @param {string} options.privateKey - Ethereum private key
   * @param {Object} options.proxyConfig - Optional proxy configuration
   */
  constructor(options = {}) {
    const { privateKey, proxyConfig = null } = options;
    
    if (!privateKey) {
      throw new Error('Private key is required for wallet');
    }
    
    this.ethersWallet = new ethers.Wallet(privateKey);
    this.proxyConfig = proxyConfig;
    this.address = this.ethersWallet.address;
    this.authenticated = false;
    this.tokens = {
      privy: null,
      privyId: null,
      deform: null
    };
  }
  
  /**
   * Gets the wallet address
   * @returns {string} Ethereum address
   */
  getAddress() {
    return this.address;
  }
  
  /**
   * Gets the wallet's Ethers.js instance
   * @returns {ethers.Wallet} Ethers wallet
   */
  getEthersWallet() {
    return this.ethersWallet;
  }
  
  /**
   * Gets the wallet's proxy configuration
   * @returns {Object|null} Proxy configuration
   */
  getProxyConfig() {
    return this.proxyConfig;
  }
  
  /**
   * Sets authentication state and tokens
   * @param {Object} authResult - Authentication result
   * @param {string} authResult.privyToken - Privy token
   * @param {string} authResult.privyIdToken - Privy ID token
   * @param {string} authResult.deformToken - Deform token
   */
  setAuthenticated(authResult) {
    this.authenticated = true;
    this.tokens = {
      privy: authResult.privyToken,
      privyId: authResult.privyIdToken,
      deform: authResult.deformToken
    };
  }
  
  /**
   * Checks if the wallet is authenticated
   * @returns {boolean} Authentication status
   */
  isAuthenticated() {
    return this.authenticated;
  }
  
  /**
   * Gets authentication tokens
   * @returns {Object} Authentication tokens
   */
  getTokens() {
    return this.tokens;
  }
  
  /**
   * Creates a masked representation of the private key
   * @returns {string} Masked private key
   */
  getMaskedPrivateKey() {
    const pk = this.ethersWallet.privateKey;
    if (!pk) return 'Invalid private key';
    
    const prefix = pk.slice(0, 6);
    const suffix = pk.slice(-4);
    return `${prefix}...${suffix}`;
  }
  
  /**
   * Returns a string representation of the wallet
   * @returns {string} Wallet string representation
   */
  toString() {
    return `Wallet(${this.address})`;
  }
  
  /**
   * Returns a JSON representation of the wallet
   * @returns {Object} Wallet JSON representation
   */
  toJSON() {
    return {
      address: this.address,
      authenticated: this.authenticated,
      hasProxy: Boolean(this.proxyConfig),
      proxyHost: this.proxyConfig?.host || null
    };
  }
}

module.exports = Wallet;