/**
 * Task Processor
 * 
 * Core module that:
 * - Processes tasks for all wallets
 * - Handles authentication
 * - Coordinates the overall automation flow
 */

const ethers = require('ethers');
const config = require('./config');
const Wallet = require('./models/wallet');
const AuthService = require('./services/auth-service');
const TaskService = require('./services/task-service');
const { sleep } = require('./utils/retry');
const { getProxyDisplayString } = require('./utils/proxy');

class TaskProcessor {
  /**
   * Creates a new task processor
   * @param {Object} options - Processor options
   * @param {Object} options.logger - Logger instance
   */
  constructor(options = {}) {
    const { logger = console } = options;
    
    this.logger = logger;
    this.wallets = [];
  }
  
  /**
   * Initializes wallets from configuration
   * @returns {Promise<Array>} Initialized wallets
   */
  async initializeWallets() {
    this.logger.info('Initializing wallets');
    
    try {
      // Get private keys and proxy configurations
      const privateKeys = config.privateKeys;
      const proxyConfigs = config.proxyConfigs;
      
      if (!privateKeys || privateKeys.length === 0) {
        throw new Error('No private keys found in configuration');
      }
      
      this.logger.info(`Found ${privateKeys.length} private keys`);
      
      // Create wallet models
      this.wallets = privateKeys.map((privateKey, index) => {
        // Match proxy config or use null
        const proxyConfig = proxyConfigs.length >= privateKeys.length 
          ? proxyConfigs[index]
          : proxyConfigs[index % proxyConfigs.length] || null;
        
        return new Wallet({ privateKey, proxyConfig });
      });
      
      // Log wallet addresses
      this.wallets.forEach((wallet, index) => {
        this.logger.info(`Initialized wallet ${index + 1}`, { 
          address: wallet.getAddress(),
          proxy: getProxyDisplayString(wallet.getProxyConfig())
        });
      });
      
      return this.wallets;
    } catch (error) {
      this.logger.error('Error initializing wallets', { 
        error: error.message,
        stack: error.stack 
      });
      throw error;
    }
  }
  
  /**
   * Performs authentication for a wallet
   * @param {Wallet} wallet - Wallet to authenticate
   * @returns {Promise<Object>} Authentication result
   */
  async authenticateWallet(wallet) {
    this.logger.info(`Authenticating wallet: ${wallet.getAddress()}`);
    
    try {
      const authService = new AuthService({
        logger: this.logger,
        wallet: wallet.getEthersWallet(),
        proxyConfig: wallet.getProxyConfig()
      });
      
      const authResult = await authService.login();
      
      // Store authentication state in wallet
      wallet.setAuthenticated(authResult);
      
      this.logger.info(`Authentication successful for ${wallet.getAddress()}`);
      
      return {
        wallet,
        authResult,
        apiClient: authResult.apiClient
      };
    } catch (error) {
      this.logger.error(`Authentication failed for ${wallet.getAddress()}`, {
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Processes tasks for a single wallet
   * @param {Wallet} wallet - Wallet to process tasks for
   * @returns {Promise<Object>} Task processing result
   */
  async processWalletTasks(wallet) {
    this.logger.info(`Processing tasks for wallet: ${wallet.getAddress()}`);
    
    try {
      // Authenticate wallet
      const { apiClient } = await this.authenticateWallet(wallet);
      
      // Create task service
      const taskService = new TaskService({
        logger: this.logger,
        apiClient,
        walletAddress: wallet.getAddress()
      });
      
      // Process all tasks
      const result = await taskService.processAllTasks();
      
      return {
        wallet: wallet.getAddress(),
        ...result
      };
    } catch (error) {
      this.logger.error(`Failed to process tasks for ${wallet.getAddress()}`, {
        error: error.message
      });
      
      return {
        wallet: wallet.getAddress(),
        error: error.message,
        success: false,
        totalTasks: 0,
        completedCount: 0,
        failedCount: 0,
        totalPoints: 0,
        completedTasks: [],
        failedTasks: []
      };
    }
  }
  
  /**
   * Processes tasks for all wallets
   * @returns {Promise<Array>} Results for all wallets
   */
  async processAllWallets() {
    this.logger.info('=== STARTING MULTI-ACCOUNT TASK PROCESSING ===');
    
    try {
      // Initialize wallets if not already done
      if (this.wallets.length === 0) {
        await this.initializeWallets();
      }
      
      const results = [];
      
      // Process each wallet sequentially
      for (const wallet of this.wallets) {
        try {
          this.logger.info(`=== PROCESSING WALLET: ${wallet.getAddress()} ===`);
          
          const result = await this.processWalletTasks(wallet);
          results.push(result);
          
          // Add delay between wallets to avoid rate limiting
          if (wallet !== this.wallets[this.wallets.length - 1]) {
            await sleep(5000);
          }
        } catch (walletError) {
          this.logger.error(`Error processing wallet ${wallet.getAddress()}`, { 
            error: walletError.message
          });
          
          results.push({
            wallet: wallet.getAddress(),
            error: walletError.message,
            success: false
          });
        }
      }
      
      // Log summary
      this.logSummary(results);
      
      return results;
    } catch (error) {
      this.logger.error('Fatal error in multi-account processing', { 
        error: error.message,
        stack: error.stack 
      });
      throw error;
    }
  }
  
  /**
   * Logs summary of task processing
   * @param {Array} results - Processing results
   */
  logSummary(results) {
    this.logger.info('=== MULTI-ACCOUNT TASKS SUMMARY ===');
    
    const totalWallets = results.length;
    const successfulWallets = results.filter(r => !r.error).length;
    const failedWallets = results.filter(r => r.error).length;
    
    this.logger.info(`Total wallets processed: ${totalWallets}`);
    this.logger.info(`Successfully processed: ${successfulWallets}`);
    this.logger.info(`Failed to process: ${failedWallets}`);
    
    results.forEach(result => {
      const completedCount = result.completedTasks?.length || 0;
      const failedCount = result.failedTasks?.length || 0;
      
      if (result.error) {
        this.logger.info(`Wallet ${result.wallet}: FAILED - ${result.error}`);
      } else {
        // Calculate total points earned
        const totalPoints = result.completedTasks?.reduce((sum, task) => sum + (task.points || 0), 0) || 0;
        this.logger.info(`Wallet ${result.wallet}: ${completedCount} completed, ${failedCount} failed, ${totalPoints} points earned`);
      }
    });
  }
}

module.exports = TaskProcessor;
