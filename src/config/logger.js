/**
 * Centralized Logging Configuration
 * 
 * Configures Winston logger with:
 * - Console output with colorization
 * - File logging with daily rotation
 * - Customizable log levels
 * - Sensitive data masking
 */

const winston = require('winston');
const path = require('path');
const DailyRotateFile = require('winston-daily-rotate-file');
const config = require('./index');

// Ensure logs directory exists
config.ensureLogsDirectory();

/**
 * Masks sensitive data in log objects
 * @param {object} info - Log information object
 * @returns {object} - Log info with masked sensitive data
 */
const maskSensitiveData = (info) => {
  if (typeof info !== 'object' || info === null) return info;
  
  const maskedInfo = { ...info };
  
  // List of sensitive field names to mask
  const sensitiveFields = [
    'privateKey', 'password', 'token', 'secret', 'signature', 'auth', 
    'authorization', 'privy-id-token', 'privyIdToken', 'privyToken'
  ];
  
  // Recursively mask sensitive fields
  const maskObject = (obj) => {
    if (typeof obj !== 'object' || obj === null) return;
    
    Object.keys(obj).forEach(key => {
      // Check if key is sensitive
      if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        // Mask the value, preserving type information
        if (typeof obj[key] === 'string') {
          const visibleChars = Math.min(4, obj[key].length);
          obj[key] = visibleChars > 0 
            ? obj[key].slice(0, visibleChars) + '********' 
            : '********';
        } else {
          obj[key] = '********';
        }
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        // Recursively check nested objects
        maskObject(obj[key]);
      }
    });
  };
  
  maskObject(maskedInfo);
  return maskedInfo;
};

/**
 * Creates a Winston format that masks sensitive data
 */
const maskFormat = winston.format((info) => {
  return maskSensitiveData(info);
});

/**
 * Creates a configured Winston logger instance
 * @param {string} service - Service name for the logger
 * @param {string} level - Minimum log level
 * @returns {winston.Logger} Configured logger instance
 */
function createLogger(service = 'ofc-automation', level = 'info') {
  return winston.createLogger({
    level: level,
    format: winston.format.combine(
      maskFormat(),
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json()
    ),
    defaultMeta: { service },
    transports: [
      // Colored console transport for development
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize({ all: true }),
          winston.format.printf(({ timestamp, level, message, service, ...rest }) => {
            // Create a clean message excluding large objects
            let cleanRest = { ...rest };
            delete cleanRest.stack; // Don't show stack in console

            // Format object data for console
            const restString = Object.keys(cleanRest).length 
              ? `\n${JSON.stringify(cleanRest, null, 2)}` 
              : '';
              
            return `${timestamp} [${service}] ${level}: ${message}${restString}`;
          })
        )
      }),
      
      // Daily rotating error log file transport
      new DailyRotateFile({
        filename: path.join(config.LOGS_DIR, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '14d'
      }),
      
      // Daily rotating combined log file transport
      new DailyRotateFile({
        filename: path.join(config.LOGS_DIR, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d'
      })
    ]
  });
}

module.exports = {
  createLogger
};