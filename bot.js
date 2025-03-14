const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ethers = require('ethers');
const {HttpsProxyAgent} = require('https-proxy-agent');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

// Ensure you install the following dependencies:
// npm install axios ethers https-proxy-agent winston winston-daily-rotate-file

// Winston Logger Configuration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'ofc-multi-account-automation' },
    transports: [
        // Colored console transport for development
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize({ all: true }),
                winston.format.printf(({ timestamp, level, message, stack }) => {
                    return `${timestamp} ${level}: ${message}${stack ? `\n${stack}` : ''}`;
                })
            )
        }),
        // Daily rotating error log file transport
        new DailyRotateFile({
            filename: path.join('logs', 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxSize: '20m',
            maxFiles: '14d'
        }),
        // Daily rotating combined log file transport
        new DailyRotateFile({
            filename: path.join('logs', 'combined-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'info',
            maxSize: '20m',
            maxFiles: '14d'
        })
    ]
});

class OFCMultiAccountAutomation {
    constructor() {
        this.baseUrl = 'https://api.deform.cc/';
        this.privyAuthUrl = 'https://auth.privy.io/api/v1/siwe';
        this.deformLoginUrl = 'https://api.deform.cc/';
        this.walletsConfig = [];
        this.currentWalletConfig = null;
        this.token = null;
        this.privyIdToken = null;
        this.axiosInstance = null;
        this.maxRetries = 10;
        this.retryDelay = 5000;
        this.logger = logger;
    }

    logRequest(method, url, headers, data) {
        this.logger.debug('Request Details', {
            method: method.toUpperCase(),
            url,
            headers,
            payload: data ? JSON.stringify(data, null, 2) : 'No payload'
        });
    }

    logResponse(response) {
        this.logger.debug('Response Details', {
            status: response.status,
            headers: response.headers,
            data: response.data ? JSON.stringify(response.data, null, 2) : 'No data'
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async retryOperation(operation, retries = this.maxRetries) {
        for (let i = 0; i < retries; i++) {
            try {
                const result = await operation();
                return result;
            } catch (error) {
                const errorMsg = `${error.message} (${error.code || 'NO_CODE'})`;
                this.logger.warn(`Attempt ${i + 1} failed`, {
                    errorMessage: errorMsg,
                    responseStatus: error.response?.status,
                    responseHeaders: error.response?.headers,
                    responseData: error.response?.data ? JSON.stringify(error.response.data, null, 2) : 'No data'
                });

                if (i === retries - 1) {
                    this.logger.error('Operation failed after maximum retries', { 
                        error,
                        fullError: JSON.stringify(error, null, 2)
                    });
                    throw error;
                }
                
                this.logger.info(`Retrying in ${this.retryDelay/1000} seconds...`);
                await this.sleep(this.retryDelay);
            }
        }
    }

    parseProxy(proxyConfig) {
        if (!proxyConfig) return null;
        
        try {
            const proxyUrl = `http://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`;
            return {
                proxyUrl,
                agent: new HttpsProxyAgent(proxyUrl)
            };
        } catch (error) {
            this.logger.error('Proxy parsing error', { error: error.message });
            throw new Error(`Proxy parsing error: ${error.message}`);
        }
    }

    async initializeWalletConfig(walletConfig) {
        this.currentWalletConfig = walletConfig;
        
        // Configure Axios instance
        const axiosConfig = {
            baseURL: this.baseUrl,
            timeout: 30000, // 30 seconds timeout
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        };

        // Apply proxy if configured
        if (walletConfig.proxy) {
            const proxyConfig = this.parseProxy(walletConfig.proxy);
            this.logger.info('Proxy Configuration', {
                host: walletConfig.proxy.host,
                port: walletConfig.proxy.port,
                username: walletConfig.proxy.username,
                passwordMasked: '********'
            });

            axiosConfig.httpsAgent = proxyConfig.agent;
            axiosConfig.httpAgent = proxyConfig.agent;
            axiosConfig.proxy = false;
        }

        // Create Axios instance
        this.axiosInstance = axios.create(axiosConfig);

        // Add request and response interceptors
        this.addAxiosInterceptors();

        return this.axiosInstance;
    }

    addAxiosInterceptors() {
        // Request interceptor
        this.axiosInstance.interceptors.request.use(
            config => {
                this.logRequest(config.method, config.url, config.headers, config.data);
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
        this.axiosInstance.interceptors.response.use(
            response => {
                this.logResponse(response);
                return response;
            },
            error => {
                const errorDetails = {
                    message: error.message,
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    headers: error.response?.headers,
                    config: {
                        method: error.config?.method,
                        url: error.config?.url,
                        headers: error.config?.headers
                    }
                };

                this.logger.error('Detailed Response Interceptor Error', errorDetails);

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

                return Promise.reject(error);
            }
        );
    }

    async readConfigFiles() {
        try {
            // Baca private keys
            const privateKeysContent = fs.readFileSync('pk.txt', 'utf8')
                .trim()
                .split('\n')
                .map(pk => pk.trim())
                .filter(pk => pk);

            // Baca proxy configurations
            const proxyConfigsRaw = fs.readFileSync('proxy.txt', 'utf8')
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

            // Sesuaikan jumlah proxy dengan jumlah private key
            const proxyConfigs = proxyConfigsRaw.length >= privateKeysContent.length 
                ? proxyConfigsRaw.slice(0, privateKeysContent.length)
                : privateKeysContent.map((_, index) => 
                    proxyConfigsRaw[index % proxyConfigsRaw.length] || null
                );

            // Buat konfigurasi wallet
            this.walletsConfig = privateKeysContent.map((pk, index) => ({
                wallet: new ethers.Wallet(pk),
                proxy: proxyConfigs[index]
            }));

            // Log alamat wallet
            this.walletsConfig.forEach((config, index) => {
                this.logger.info(`Wallet ${index + 1} Configuration`, { 
                    address: config.wallet.address,
                    proxyHost: config.proxy?.host || 'No Proxy'
                });
            });

            return this.walletsConfig;
        } catch (error) {
            this.logger.error('Error reading configuration files', { 
                error: error.message,
                stack: error.stack 
            });
            throw error;
        }
    }

    async getNonce() {
        return this.retryOperation(async () => {
            const response = await this.axiosInstance.post(`${this.privyAuthUrl}/init`, {
                address: this.currentWalletConfig.wallet.address
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Origin': 'https://ofc.onefootball.com',
                    'Referer': 'https://ofc.onefootball.com/',
                    //'Cookie': '__cf_bm=_NtrUrdhEOBOG502fIzhQfKjf4q6292YS6VyjmN1eHw-1739715983-1.0.1.1-KORmrMBUidJDKtYbrmwzbvhsMhGKFu6Jssgk0hJNEcQmzuGjGUofNCSBnolwxNxQG9a8xAcPqDFZTQT96o2m.w; _cfuvid=MAuUDPpwYSqgThzM.TYCVW2PV1xzBNKn64AWLDeWwpQ-1739715993962-0.0.1.1-604800000; cf_clearance=6ebXjXdATow5WfmHOjDOlq0uCXK7Ijf7DWY9yO7dULs-1739715996-1.2.1.1-0abKYxaADuxBxroLrjopVi3HhLHsyCIdYzw7WkDCExRq8CCPHTXq63eyjAWhk1Wp.Q.R4_GIC77TxqN6fqbr3rUsKuIC1nq8obMdJHN9O24saCdylsc2FmGODrnRoX2qfz8CM6r1YKS1Alb4QqKNx..2FFTBmBB5PZBRZ0RUszECkupn1PKAHUGY76MSVx5cUHWlFsio6dKIV4PeGoSKHh6m5wCVviuFKDmuZArouNFyEYuXyg_DocG1_HvtxU1j_dnGfoJhgIuuZHGyZzaaT1hXRtDIMQjiwGGfLrtr4X0',
                    //'rivy-ca-id': 'e8a13340-45d4-4b73-9af9-7d6d7fc9763d',
                    'Privy-App-Id': 'clphlvsh3034xjw0fvs59mrdc',
                    'Privy-Client': 'react-auth:2.4.1',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
                }
            });
            return response.data;
        });
    }

    async login() {
        try {
            this.logger.info(`Logging in for wallet: ${this.currentWalletConfig.wallet.address}`);
            
            // Get Privy authentication token
            const { nonce } = await this.getNonce();
            const timestamp = new Date().toISOString();
            
            const message = `ofc.onefootball.com wants you to sign in with your Ethereum account:
${this.currentWalletConfig.wallet.address}

By signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.

URI: https://ofc.onefootball.com
Version: 1
Chain ID: 1
Nonce: ${nonce}
Issued At: ${timestamp}
Resources:
- https://privy.io`;

            //this.logger.info('Signing message', { message });
            const signature = await this.currentWalletConfig.wallet.signMessage(message);
            this.logger.info('Signature generated', { signature });

            const privyResponse = await this.retryOperation(async () => {
                return await this.axiosInstance.post(`${this.privyAuthUrl}/authenticate`, {
                    message,
                    signature,
                    chainId: "eip155:1",
                    walletClientType: "rabby_wallet",
                    connectorType: "injected",
                    mode: "login-or-sign-up"
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Origin': 'https://ofc.onefootball.com',
                        'Referer': 'https://ofc.onefootball.com/',
                        'Privy-app-id': 'clphlvsh3034xjw0fvs59mrdc',
                        //'Cookie': '__cf_bm=JPYRNw_EwIlZipL0bjDbMrLUaUaeYzDmTE.NroWy0X0-1739714777-1.0.1.1-icxtqiuclkLQ4huWnCR5wvsDs69khljNfAuljNrXNEZgoEoSYz9FOyQPBuHdRoVwldzYLoR3O9zpFkC7j2UwFw; _cfuvid=nCILXJrNmitugVtQ0Pdkyw7H5Snlfw3oeRpa7LhSr9g-1739714777167-0.0.1.1-604800000; cf_clearance=vlIYxzwsMJBl5jpnDnwHG_xYqbQzBK1uJY__1YqB5RI-1739714782-1.2.1.1-T06gTXIUFXYFTh4Mq54GrEEbe6QKxebohrhGSdXLWKI1P_rvngeawbeI6YRU_eBABsVVLfvNXirAjsS8C3ipvsappIYfEezK_E8rqLVUZAwuq2QPVsKLiiz_5pj3wa0kNZpFDZZn8VKpJY7j0B67Ba.Cc2w_qa_WWDsoZZBzq9LOL7Uc3fzhDEcD.G9fDAUxNCA4YULBLd3QG_b3UQlwKcs1YYzcRIBCws0SzE7vQL5J9UDXVg2yg5jjR1qslhpaULl_42YC4Tw8ze5vQeYwxgaGSNRtdTiwYJvbkMdv2BM',
                        //''rivy-ca-id': '98e8ed94-4b86-45d7-be61-62573c15f2c1',
                        'Privy-Client': 'react-auth:2.4.1',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
                    }
                });
            });
            
            const privyToken = privyResponse.data.token;
            this.privyIdToken = privyResponse.data.identity_token;
            this.logger.info('Privy Token Generated', { token: privyToken });

            // Use Privy token to login to Deform
            const deformLoginResponse = await this.retryOperation(async () => {
                return await this.axiosInstance.post(this.deformLoginUrl, {
                    operationName: "UserLogin",
                    variables: {
                        data: {
                            externalAuthToken: privyToken
                        }
                    },
                    query: `mutation UserLogin($data: UserLoginInput!) {
                        userLogin(data: $data)
                    }`
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': '*/*',
                        'Origin': 'https://ofc.onefootball.com',
                        'Referer': 'https://ofc.onefootball.com/',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
                    }
                });
            });

            // Save Deform login token
            this.token = deformLoginResponse.data.data.userLogin;
            this.logger.info('Deform Login Token Generated', { 
                token: this.token,
                walletAddress: this.currentWalletConfig.wallet.address 
            });

            return this.token;
        } catch (error) {
            this.logger.error('Login Error', { 
                walletAddress: this.currentWalletConfig.wallet.address,
                error: error.message,
                stack: error.stack 
            });
            throw error;
        }
    }

    async getAvailableTasks() {
        this.logger.info(`Fetching Available Tasks for wallet: ${this.currentWalletConfig.wallet.address}`);
        return this.retryOperation(async () => {
            const fragmentQuery = `fragment ActivityFields on CampaignActivity {
      id
      createdAt
      updatedAt
      startDateTimeAt
      endDateTimeAt
      title
      description
      coverAssetUrl
      type
      identityType
      recurringPeriod {
        count
        type
        __typename
      }
      recurringMaxCount
      properties
      records {
        id
        status
        createdAt
        activityId
        properties
        rewardRecords {
          id
          status
          appliedRewardType
          appliedRewardQuantity
          appliedRewardMetadata
          error
          rewardId
          reward {
            id
            quantity
            type
            properties
            __typename
          }
          __typename
        }
        __typename
      }
      tags {
        id
        name
        __typename
      }
      reward {
        id
        title
        description
        quantity
        type
        imageUrl
        properties
        __typename
      }
      targetReward {
        id
        activityId
        missionId
        __typename
      }
      nft {
        id
        tokenId
        name
        description
        image
        properties
        mintPrice
        platformFee
        maxSupply
        maxMintCountPerAddress
        nftContract {
          id
          address
          type
          chainId
          __typename
        }
        __typename
      }
      isHidden
      __typename
    }
    
    query CampaignActivitiesPanel($campaignId: String!) {
      campaign(id: $campaignId) {
        activities {
          ...ActivityFields
          __typename
        }
        __typename
      }
    }`;
    
            try {
                const response = await this.axiosInstance.post(this.baseUrl, {
                    operationName: "CampaignActivitiesPanel",
                    query: fragmentQuery,
                    variables: {
                        campaignId: "30ea55e5-cf99-4f21-a577-5c304b0c61e2"
                    }
                }, {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json',
                        'Accept': '*/*',
                        'Accept-Encoding': 'gzip, deflate, br, zstd',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Origin': 'https://ofc.onefootball.com',
                        'Referer': 'https://ofc.onefootball.com/',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
                    }
                });
                
                // Log raw response for debugging
                this.logger.debug('Raw Tasks Response', { 
                    status: response.status,
                    data: JSON.stringify(response.data, null, 2)
                });
                
                // Filter incomplete tasks
                const allIncompleteTasks = this.filterIncompleteTasks(response.data.data.campaign.activities);
                
                // Define task types that require manual interaction and should be skipped
                const skippedTaskTypes = ['FARCASTER_FOLLOW', 'REFERRAL', 'REFEREE_SIGNUP_BONUS'];
                
                // Filter out tasks that can't be completed programmatically
                const automatedTasks = allIncompleteTasks.filter(task => !skippedTaskTypes.includes(task.type));
                
                // Log skipped tasks
                const skippedTasks = allIncompleteTasks.filter(task => skippedTaskTypes.includes(task.type));
                if (skippedTasks.length > 0) {
                    this.logger.info(`Skipping ${skippedTasks.length} tasks that require manual action:`, {
                        skippedTasks: skippedTasks.map(t => `${t.title} (${t.type})`)
                    });
                }
                
                // Log details of each task
                automatedTasks.forEach(task => {
                    this.logger.debug('Task Details', {
                        id: task.id,
                        title: task.title,
                        type: task.type,
                        records: task.records,
                        properties: task.properties
                    });
                });
                
                this.logger.info(`Found ${automatedTasks.length} available tasks for wallet ${this.currentWalletConfig.wallet.address}`);
                return automatedTasks;
            } catch (error) {
                this.logger.error('Error fetching tasks', {
                    walletAddress: this.currentWalletConfig.wallet.address,
                    errorMessage: error.message,
                    stack: error.stack,
                    responseData: error.response?.data,
                    responseStatus: error.response?.status
                });
                throw error;
            }
        });
    }

    filterIncompleteTasks(activities) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        
        return activities.filter(activity => {
            // Skip hidden tasks
            if (activity.isHidden) return false;
    
            // If no records exist, task is considered available
            if (!activity.records || activity.records.length === 0) return true;
    
            // For recurring daily tasks, check if already completed today
            if (activity.recurringPeriod && 
                activity.recurringPeriod.type === "DAY" && 
                activity.recurringPeriod.count === 1) {
                
                // Get most recent completion date
                const sortedRecords = [...activity.records].sort((a, b) => 
                    new Date(b.createdAt) - new Date(a.createdAt)
                );
                
                if (sortedRecords.length > 0 && sortedRecords[0].status === "COMPLETED") {
                    const lastCompletionDate = new Date(sortedRecords[0].createdAt);
                    const lastCompletionDay = new Date(
                        lastCompletionDate.getFullYear(), 
                        lastCompletionDate.getMonth(), 
                        lastCompletionDate.getDate()
                    ).getTime();
                    
                    // If last completion was today, task is not available
                    return lastCompletionDay < today;
                }
            }
    
            // For non-recurring tasks, check if already completed
            return !activity.records.some(record => 
                record.status === "COMPLETED" || 
                record.rewardRecords?.some(reward => reward.status === "COMPLETED")
            );
        });
    }

    async verifyTask(activityId, activityType) {
        this.logger.info(`Verifying Task: ${activityId} (Type: ${activityType}) for wallet: ${this.currentWalletConfig.wallet.address}`);
        
        try {
            // Special handling for different task types
            switch(activityType) {
                case 'TWITTER_FOLLOW':
                    return this.handleTwitterFollow(activityId);
                case 'FARCASTER_FOLLOW':
                    return this.handleFarcasterFollow(activityId);
                case 'QUIZ':
                    return this.handleQuizTask(activityId);
                case 'TWEET_RETWEET':
                    return this.handleTwitterRetweet(activityId);
                case 'EXTERNAL_LINK':
                    return this.handleExternalLink(activityId);
                case 'REFERRAL':
                case 'REFEREE_SIGNUP_BONUS':
                    return this.defaultVerifyTask(activityId);
                case 'GM':
                case 'CHECK_IN':
                    return this.defaultVerifyTask(activityId);
                default:
                    this.logger.warn(`Unhandled task type: ${activityType} for wallet ${this.currentWalletConfig.wallet.address}. Using default verification.`);
                    return this.defaultVerifyTask(activityId);
            }
        } catch (error) {
            this.logger.error(`Verification failed for task ${activityId}`, {
                walletAddress: this.currentWalletConfig.wallet.address,
                type: activityType,
                errorMessage: error.message,
                stack: error.stack,
                responseData: error.response?.data,
                responseStatus: error.response?.status
            });
            throw error;
        }
    }

    async defaultVerifyTask(activityId) {
        return this.retryOperation(async () => {
            const response = await this.axiosInstance.post(this.baseUrl, {
                operationName: "VerifyActivity",
                variables: { data: { activityId } },
                query: `mutation VerifyActivity($data: VerifyActivityInput!) {
                    verifyActivity(data: $data) {
                        record {
                            id status rewardRecords { status appliedRewardQuantity }
                        }
                    }
                }`
            }, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                    'privy-id-token': this.privyIdToken
                }
            });
                
            const result = response.data?.data?.verifyActivity?.record;
            if (result) {
                this.logger.info('Task verification result', { 
                    walletAddress: this.currentWalletConfig.wallet.address,
                    result: JSON.stringify(result, null, 2) 
                });
            }
            return result;
        });
    }

    async handleTwitterFollow(activityId) {
        const username = await this.extractUsername(activityId, 'TWITTER_FOLLOW');
        this.logger.info(`Attempting to follow Twitter user for wallet ${this.currentWalletConfig.wallet.address}: ${username}`);
        return this.defaultVerifyTask(activityId);
    }

    async handleFarcasterFollow(activityId) {
        const username = await this.extractUsername(activityId, 'FARCASTER_FOLLOW');
        this.logger.info(`Attempting to follow Farcaster user for wallet ${this.currentWalletConfig.wallet.address}: ${username}`);
        return this.defaultVerifyTask(activityId);
    }

    async handleTwitterRetweet(activityId) {
        const tweetLink = await this.extractTweetLink(activityId);
        this.logger.info(`Attempting to retweet for wallet ${this.currentWalletConfig.wallet.address}: ${tweetLink}`);
        return this.defaultVerifyTask(activityId);
    }

    async handleExternalLink(activityId) {
        const link = await this.extractExternalLink(activityId);
        this.logger.info(`Attempting to visit external link for wallet ${this.currentWalletConfig.wallet.address}: ${link}`);
        return this.defaultVerifyTask(activityId);
    }

    async getQuizAnswers(activityId) {
        const quizAnswers = {
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

        return quizAnswers[activityId] || [];
    }

    async handleQuizTask(activityId) {
        this.logger.info(`Attempting to complete quiz task for wallet ${this.currentWalletConfig.wallet.address}`);
        
        try {
            // Get the correct answers for this specific quiz
            const responses = await this.getQuizAnswers(activityId);
            
            if (responses.length === 0) {
                this.logger.warn(`No answers found for quiz: ${activityId}`);
                return this.defaultVerifyTask(activityId);
            }

            // Prepare the verification payload
            const verifyPayload = {
                operationName: "VerifyActivity",
                variables: {
                    data: {
                        activityId: activityId,
                        metadata: { responses: responses }
                    }
                },
                query: `mutation VerifyActivity($data: VerifyActivityInput!) {
                    verifyActivity(data: $data) {
                        record {
                            id
                            activityId
                            status
                            properties
                            createdAt
                            rewardRecords {
                                id
                                status
                                appliedRewardType
                                appliedRewardQuantity
                                appliedRewardMetadata
                                error
                                rewardId
                                reward {
                                    id
                                    quantity
                                    type
                                    properties
                                    __typename
                                }
                                __typename
                            }
                            __typename
                        }
                        missionRecord {
                            id
                            missionId
                            status
                            createdAt
                            rewardRecords {
                                id
                                status
                                appliedRewardType
                                appliedRewardQuantity
                                appliedRewardMetadata
                                error
                                rewardId
                                reward {
                                    id
                                    quantity
                                    type
                                    properties
                                    __typename
                                }
                                __typename
                            }
                            __typename
                        }
                        __typename
                    }
                }`
            };

            // Send the verification request
            const response = await this.axiosInstance.post(this.baseUrl, verifyPayload, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                    'privy-id-token': this.privyIdToken
                }
            });

            // Process and log the response
            const result = response.data?.data?.verifyActivity?.record;
            if (result) {
                this.logger.info('Quiz task verification result', { 
                    walletAddress: this.currentWalletConfig.wallet.address,
                    result: JSON.stringify(result, null, 2) 
                });
            }

            return result;
        } catch (error) {
            this.logger.error('Error in quiz task handling', {
                walletAddress: this.currentWalletConfig.wallet.address,
                activityId,
                errorMessage: error.message,
                stack: error.stack,
                responseData: error.response?.data
            });
            throw error;
        }
    }

    async extractUsername(activityId, type) {
        const activities = await this.getAvailableTasks();
        const activity = activities.find(a => a.id === activityId && a.type === type);
        return activity?.properties?.username || activity?.properties?.fid;
    }

    async extractTweetLink(activityId) {
        const activities = await this.getAvailableTasks();
        const activity = activities.find(a => a.id === activityId && a.type === 'TWEET_RETWEET');
        return activity?.properties?.link;
    }

    async extractExternalLink(activityId) {
        const activities = await this.getAvailableTasks();
        const activity = activities.find(a => a.id === activityId && a.type === 'EXTERNAL_LINK');
        return activity?.properties?.link;
    }

    async processTasksForWallet() {
        try {
            const tasks = await this.getAvailableTasks();
            const completedTasks = [];
            const failedTasks = [];

            // Sort tasks to prioritize certain types
            const priorityOrder = [
                'GM', 'CHECK_IN', 
                'TWITTER_FOLLOW', 'FARCASTER_FOLLOW', 
                'TWEET_RETWEET', 
                'EXTERNAL_LINK', 'QUIZ',
                'REFERRAL', 'REFEREE_SIGNUP_BONUS'
            ];

            // Sort tasks based on priority
            const sortedTasks = tasks.sort((a, b) => {
                const priorityA = priorityOrder.indexOf(a.type);
                const priorityB = priorityOrder.indexOf(b.type);
                return priorityA - priorityB;
            });

            for (const task of sortedTasks) {
                this.logger.info(`Processing task for ${this.currentWalletConfig.wallet.address}: ${task.title} (Type: ${task.type})`);
                
                try {
                    // Add a small delay between tasks to avoid rate limiting
                    await this.sleep(2000);

                    const result = await this.verifyTask(task.id, task.type);
                    
                    if (result?.status === "COMPLETED") {
                        this.logger.info(`✅ Task completed for ${this.currentWalletConfig.wallet.address}: ${task.title}`);
                        const points = result.rewardRecords?.[0]?.appliedRewardQuantity || 0;
                        completedTasks.push({
                            title: task.title,
                            type: task.type,
                            points: points
                        });
                    } else {
                        this.logger.warn(`❌ Failed to complete task for ${this.currentWalletConfig.wallet.address}: ${task.title}`);
                        failedTasks.push({
                            title: task.title,
                            type: task.type,
                            result: result
                        });
                    }
                } catch (taskError) {
                    this.logger.error(`Error processing task for ${this.currentWalletConfig.wallet.address} - ${task.title}`, { 
                        error: taskError.message,
                        stack: taskError.stack,
                        taskDetails: {
                            id: task.id,
                            title: task.title,
                            type: task.type
                        }
                    });
                    failedTasks.push({
                        title: task.title,
                        type: task.type,
                        error: taskError.message
                    });
                }
            }

            // Task summary
            this.logger.info(`=== DAILY TASKS SUMMARY FOR ${this.currentWalletConfig.wallet.address} ===`);
            this.logger.info(`Total Tasks: ${tasks.length}`);
            this.logger.info(`Completed Tasks: ${completedTasks.length}`);
            this.logger.info(`Failed Tasks: ${failedTasks.length}`);

            return {
                walletAddress: this.currentWalletConfig.wallet.address,
                totalTasks: tasks.length,
                completedTasks,
                failedTasks
            };
        } catch (error) {
            this.logger.error(`=== FATAL ERROR IN DAILY TASKS FOR ${this.currentWalletConfig.wallet.address} ===`, { 
                error: error.message,
                stack: error.stack 
            });
            throw error;
        }
    }

    async handleDailyTasks() {
        const overallResults = [];

        try {
            // Baca konfigurasi wallet dan proxy
            await this.readConfigFiles();

            // Proses untuk setiap wallet
            for (const walletConfig of this.walletsConfig) {
                try {
                    this.logger.info(`=== STARTING DAILY TASKS FOR WALLET: ${walletConfig.wallet.address} ===`);
                    
                    // Inisialisasi konfigurasi wallet saat ini
                    await this.initializeWalletConfig(walletConfig);
                    
                    // Login
                    await this.login();
                    
                    // Proses tugas untuk wallet ini
                    const result = await this.processTasksForWallet();
                    overallResults.push(result);

                    // Tambahkan jeda antar wallet untuk menghindari rate limiting
                    await this.sleep(5000);
                } catch (walletError) {
                    this.logger.error(`Error processing tasks for wallet ${walletConfig.wallet.address}`, { 
                        error: walletError.message,
                        stack: walletError.stack 
                    });
                    overallResults.push({
                        walletAddress: walletConfig.wallet.address,
                        error: walletError.message
                    });
                }
            }

            // Ringkasan keseluruhan
            this.logger.info('=== MULTI-ACCOUNT TASKS SUMMARY ===');
            overallResults.forEach(result => {
                this.logger.info(`Wallet ${result.walletAddress}:`, {
                    totalTasks: result.totalTasks || 0,
                    completedTasks: result.completedTasks ? result.completedTasks.length : 0,
                    failedTasks: result.failedTasks ? result.failedTasks.length : 0,
                    error: result.error
                });
            });

            return overallResults;
        } catch (error) {
            this.logger.error('Fatal error in multi-account automation', { 
                error: error.message,
                stack: error.stack 
            });
            throw error;
        }
    }
}

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

class AutomationScheduler {
    constructor() {
        this.INTERVAL_HOURS = 25;
        this.automation = new OFCMultiAccountAutomation();
        this.nextRunTime = null;
    }

    calculateNextRunTime() {
        const now = new Date();
        return new Date(now.getTime() + (this.INTERVAL_HOURS * 60 * 60 * 1000));
    }

    formatTimeRemaining(milliseconds) {
        const hours = Math.floor(milliseconds / (1000 * 60 * 60));
        const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);
        return `${hours}h ${minutes}m ${seconds}s`;
    }

    async start() {
        const runLoop = async () => {
            try {
                logger.info('Starting automation cycle...');
                await this.automation.handleDailyTasks();
                
                // Set next run time
                this.nextRunTime = this.calculateNextRunTime();
                logger.info(`Next run scheduled for: ${this.nextRunTime.toLocaleString()}`);

                // Calculate delay for next run
                const delay = this.INTERVAL_HOURS * 60 * 60 * 1000;

                // Log countdown
                const countdownInterval = setInterval(() => {
                    const now = new Date();
                    const timeRemaining = this.nextRunTime.getTime() - now.getTime();
                    
                    if (timeRemaining <= 0) {
                        clearInterval(countdownInterval);
                        return;
                    }

                    const formattedTime = this.formatTimeRemaining(timeRemaining);
                    logger.info(`Time until next run: ${formattedTime}`);
                }, 60000); // Update every minute

                // Schedule next run
                setTimeout(runLoop, delay);

            } catch (error) {
                logger.error('Error in automation cycle', { 
                    error: error.message,
                    stack: error.stack 
                });
                
                // Even if there's an error, schedule next run
                setTimeout(runLoop, this.INTERVAL_HOURS * 60 * 60 * 1000);
            }
        };

        // Start first run immediately
        await runLoop();
    }
}

// Main execution
async function startAutomation() {
    console.log('Starting OFC Multi-Account Automation with 25-hour countdown...');
    const scheduler = new AutomationScheduler();
    
    try {
        await scheduler.start();
    } catch (error) {
        logger.error('Fatal error in automation scheduler', { 
            error: error.message,
            stack: error.stack 
        });
        process.exit(1);
    }
}

// Run the automated scheduler
startAutomation();
