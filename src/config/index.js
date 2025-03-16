/**
 * Configuration Manager
 * 
 * Centralizes application configuration with support for:
 * - File-based configurations
 * - Sensible defaults
 * 
 * Provides a unified interface for configuration throughout the application.
 */

const fs = require('fs');
const path = require('path');

// Default configuration values
const defaults = {
  // API endpoints
  BASE_URL: 'https://api.deform.cc/',
  PRIVY_AUTH_URL: 'https://auth.privy.io/api/v1/siwe',
  
  // Privy auth configuration
  PRIVY_APP_ID: 'clphlvsh3034xjw0fvs59mrdc',
  PRIVY_CLIENT: 'react-auth:2.4.1',
  
  // Campaign ID
  CAMPAIGN_ID: '30ea55e5-cf99-4f21-a577-5c304b0c61e2',
  
  // Retry mechanism
  MAX_RETRIES: 10,
  RETRY_DELAY: 5000, // 5 seconds
  
  // Scheduler configuration
  INTERVAL_HOURS: 25,
  
  // Files
  WALLETS_FILE: path.resolve(process.cwd(), 'pk.txt'),
  PROXIES_FILE: path.resolve(process.cwd(), 'proxy.txt'),
  QUIZ_ANSWERS_FILE: path.resolve(__dirname, '../data/quiz-answers.json'),
  
  // User agent
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  
  // Logs directory
  LOGS_DIR: path.resolve(process.cwd(), 'logs'),
};

/**
 * Safely reads a file's content if it exists
 * @param {string} filePath - Path to the file
 * @param {string} defaultContent - Default content if file doesn't exist
 * @returns {string} File content or default
 */
function safeReadFile(filePath, defaultContent = '') {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : defaultContent;
  } catch (error) {
    console.warn(`Warning: Could not read file ${filePath}`, error.message);
    return defaultContent;
  }
}

/**
 * Gets array of private keys from file
 * @returns {string[]} Array of private keys
 */
function getPrivateKeys() {
  return safeReadFile(defaults.WALLETS_FILE)
    .trim()
    .split('\n')
    .map(pk => pk.trim())
    .filter(pk => pk);
}

/**
 * Gets array of proxy configurations from file
 * @returns {object[]} Array of proxy configurations
 */
function getProxyConfigs() {
  return safeReadFile(defaults.PROXIES_FILE)
    .trim()
    .split('\n')
    .map(proxyStr => {
      const parts = proxyStr.trim().split(':');
      return parts.length === 4 
        ? { 
            host: parts[0], 
            port: parts[1], 
            username: parts[2], 
            password: parts[3] 
          } 
        : null;
    })
    .filter(config => config);
}

/**
 * Loads quiz answers from file or provides default hardcoded values
 * @returns {object} Quiz answers mapped by activity ID
 */
function loadQuizAnswers() {
  try {
    // Try to load quiz answers from file
    if (fs.existsSync(defaults.QUIZ_ANSWERS_FILE)) {
      return JSON.parse(fs.readFileSync(defaults.QUIZ_ANSWERS_FILE, 'utf8'));
    }
  } catch (error) {
    console.warn('Warning: Could not load quiz answers from file', error.message);
  }
  
  // Fall back to hardcoded defaults (from original code)
  return {
    // Quiz #001
    "d05d17cb-9ecd-404e-850e-f7d92b895bb4": [
      { questionId: "q1", answers: [{ id: "a", text: "1,400,000" }] },
      { questionId: "q2", answers: [{ id: "d", text: "128k+" }] },
      { questionId: "q3", answers: [{ id: "d", text: "Utility token" }] }
    ],
    // Quiz #002
    "b5df53a7-1777-4fb4-b334-b2bfc23f1993": [
      { questionId: "q1", answers: [{ id: "b", text: "Start of \"Extra Time\", the last chance to earn ⚽️ BALLS" }] },
      { questionId: "q2", answers: [{ id: "d", text: "100k+" }] }
    ],
    // Quiz #003
    "09f14492-1706-4d15-8fa8-babf687f6c3e": [
      { questionId: "q2", answers: [{ id: "d", text: "400k Followers on X" }] }
    ],
    // Quiz #004
    "f9df435c-cdab-4992-af97-cb8f37e00f13": [
      { questionId: "q1", answers: [{ id: "d", text: "@_viN040" }] }
    ]
  };
}

// Create config object
const config = {
  ...defaults,
  
  // Dynamic configurations
  privateKeys: getPrivateKeys(),
  proxyConfigs: getProxyConfigs(),
  quizAnswers: loadQuizAnswers(),
  
  // Auto-create logs directory if it doesn't exist
  ensureLogsDirectory: () => {
    if (!fs.existsSync(config.LOGS_DIR)) {
      fs.mkdirSync(config.LOGS_DIR, { recursive: true });
    }
  }
};

module.exports = config;