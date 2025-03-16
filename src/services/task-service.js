/**
 * Task Service
 * 
 * Handles all task-related operations:
 * - Fetching available tasks
 * - Task verification
 * - Specialized handling for different task types
 */

const config = require('../config');

// GraphQL fragments and queries
const TASK_FRAGMENT = `fragment ActivityFields on CampaignActivity {
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
}`;

const VERIFY_MUTATION = `mutation VerifyActivity($data: VerifyActivityInput!) {
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
}`;

class TaskService {
  /**
   * Creates a new task service
   * @param {Object} options - Service options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.apiClient - API client instance
   */
  constructor(options = {}) {
    const { logger = console, apiClient } = options;
    
    if (!apiClient) {
      throw new Error('API client is required for task service');
    }
    
    this.logger = logger;
    this.apiClient = apiClient;
    this.walletAddress = options.walletAddress || 'Unknown';
    this.cachedTasks = null;
    this.skippedTaskTypes = ['FARCASTER_FOLLOW', 'REFERRAL', 'REFEREE_SIGNUP_BONUS'];
  }
  
  /**
   * Fetches all available tasks
   * @param {Object} options - Fetch options
   * @param {boolean} options.refresh - Force refresh cached tasks
   * @param {boolean} options.includeSkipped - Include tasks that require manual action
   * @returns {Promise<Array>} Available tasks
   */
  async getAvailableTasks(options = {}) {
    const { refresh = false, includeSkipped = false } = options;
    
    // Return cached tasks if available and refresh not requested
    if (this.cachedTasks && !refresh) {
      const tasks = includeSkipped 
        ? this.cachedTasks
        : this.cachedTasks.filter(task => !this.skippedTaskTypes.includes(task.type));
        
      return tasks;
    }
    
    this.logger.info(`Fetching available tasks for wallet: ${this.walletAddress}`);
    
    try {
      const query = `${TASK_FRAGMENT}
      
      query CampaignActivitiesPanel($campaignId: String!) {
        campaign(id: $campaignId) {
          activities {
            ...ActivityFields
            __typename
          }
          __typename
        }
      }`;
      
      const response = await this.apiClient.graphqlRequest(
        "CampaignActivitiesPanel",
        query,
        { campaignId: config.CAMPAIGN_ID }
      );
      
      if (!response.data?.data?.campaign?.activities) {
        this.logger.warn('No activities found in campaign response');
        return [];
      }
      
      // Filter incomplete tasks
      const allIncompleteTasks = this.filterIncompleteTasks(
        response.data.data.campaign.activities
      );
      
      // Cache all incomplete tasks
      this.cachedTasks = allIncompleteTasks;
      
      // Filter out tasks that can't be completed programmatically if requested
      const tasks = includeSkipped 
        ? allIncompleteTasks
        : allIncompleteTasks.filter(task => !this.skippedTaskTypes.includes(task.type));
      
      // Log skipped tasks
      const skippedTasks = allIncompleteTasks.filter(task => 
        this.skippedTaskTypes.includes(task.type)
      );
      
      if (skippedTasks.length > 0) {
        this.logger.info(`Skipping ${skippedTasks.length} tasks that require manual action:`, {
          skippedTasks: skippedTasks.map(t => `${t.title} (${t.type})`)
        });
      }
      
      this.logger.info(`Found ${tasks.length} available tasks for wallet ${this.walletAddress}`);
      
      return tasks;
    } catch (error) {
      this.logger.error('Error fetching tasks', {
        walletAddress: this.walletAddress,
        error: error.message
      });
      return [];
    }
  }
  
  /**
   * Filters tasks to find incomplete ones
   * @param {Array} activities - All activities/tasks
   * @returns {Array} Incomplete tasks
   */
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
  
  /**
   * Verifies a task to mark it as completed
   * @param {string} activityId - Task/activity ID
   * @param {string} activityType - Task/activity type
   * @returns {Promise<Object>} Verification result
   */
  async verifyTask(activityId, activityType) {
    this.logger.info(`Verifying task: ${activityId} (Type: ${activityType}) for wallet: ${this.walletAddress}`);
    
    try {
      // Special handling for different task types
      switch(activityType) {
        case 'TWITTER_FOLLOW':
          return this.handleTwitterFollow(activityId);
        case 'TWEET_RETWEET':
          return this.handleTwitterRetweet(activityId);
        case 'QUIZ':
          return this.handleQuizTask(activityId);
        case 'EXTERNAL_LINK':
          return this.handleExternalLink(activityId);
        case 'GM':
        case 'CHECK_IN':
        case 'FARCASTER_FOLLOW':
        case 'REFERRAL':
        case 'REFEREE_SIGNUP_BONUS':
        default:
          return this.defaultVerifyTask(activityId);
      }
    } catch (error) {
      this.logger.error(`Verification failed for task ${activityId}`, {
        type: activityType,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Default task verification method
   * @param {string} activityId - Task/activity ID
   * @returns {Promise<Object>} Verification result
   */
  async defaultVerifyTask(activityId) {
    try {
      const response = await this.apiClient.graphqlRequest(
        "VerifyActivity",
        VERIFY_MUTATION,
        { data: { activityId } }
      );
      
      const result = response.data?.data?.verifyActivity?.record;
      
      if (result) {
        // Extract only essential information from the result
        const essentialInfo = {
          status: result.status,
          points: result.rewardRecords?.[0]?.appliedRewardQuantity || 0
        };
        
        this.logger.info('Task verification result', essentialInfo);
      }
      
      return result;
    } catch (error) {
      this.logger.error('Task verification failed', {
        activityId,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Handles Twitter follow task
   * @param {string} activityId - Task/activity ID
   * @returns {Promise<Object>} Verification result
   */
  async handleTwitterFollow(activityId) {
    const username = await this.extractTaskProperty(activityId, 'TWITTER_FOLLOW', 'username');
    this.logger.info(`Following Twitter user: ${username}`);
    return this.defaultVerifyTask(activityId);
  }
  
  /**
   * Handles Twitter retweet task
   * @param {string} activityId - Task/activity ID
   * @returns {Promise<Object>} Verification result
   */
  async handleTwitterRetweet(activityId) {
    const tweetLink = await this.extractTaskProperty(activityId, 'TWEET_RETWEET', 'link');
    this.logger.info(`Retweeting: ${tweetLink}`);
    return this.defaultVerifyTask(activityId);
  }
  
  /**
   * Handles external link task
   * @param {string} activityId - Task/activity ID
   * @returns {Promise<Object>} Verification result
   */
  async handleExternalLink(activityId) {
    const link = await this.extractTaskProperty(activityId, 'EXTERNAL_LINK', 'link');
    this.logger.info(`Visiting external link: ${link}`);
    return this.defaultVerifyTask(activityId);
  }
  
  /**
   * Handles quiz task
   * @param {string} activityId - Task/activity ID
   * @returns {Promise<Object>} Verification result
   */
  async handleQuizTask(activityId) {
    this.logger.info(`Completing quiz task: ${activityId}`);
    
    try {
      // Get the correct answers for this specific quiz
      const responses = config.quizAnswers[activityId] || [];
      
      if (responses.length === 0) {
        this.logger.warn(`No answers found for quiz: ${activityId}`);
        return this.defaultVerifyTask(activityId);
      }
      
      // Verify task with quiz answers
      const response = await this.apiClient.graphqlRequest(
        "VerifyActivity",
        VERIFY_MUTATION,
        {
          data: {
            activityId: activityId,
            metadata: { responses: responses }
          }
        }
      );
      
      const result = response.data?.data?.verifyActivity?.record;
      
      if (result) {
        // Extract only essential information from the result
        const essentialInfo = {
          status: result.status,
          points: result.rewardRecords?.[0]?.appliedRewardQuantity || 0
        };
        
        this.logger.info('Quiz task verification result', essentialInfo);
      }
      
      return result;
    } catch (error) {
      this.logger.error('Error in quiz task handling', {
        activityId,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Extracts property from a task
   * @param {string} activityId - Task/activity ID
   * @param {string} activityType - Task/activity type
   * @param {string} propertyName - Property name to extract
   * @returns {Promise<string>} Property value
   */
  async extractTaskProperty(activityId, activityType, propertyName) {
    const tasks = await this.getAvailableTasks({ includeSkipped: true });
    const task = tasks.find(t => t.id === activityId && t.type === activityType);
    
    if (!task || !task.properties || !task.properties[propertyName]) {
      this.logger.warn(`Property ${propertyName} not found for task ${activityId}`);
      return null;
    }
    
    return task.properties[propertyName];
  }
  
  /**
   * Processes all available tasks
   * @returns {Promise<Object>} Processing results
   */
  async processAllTasks() {
    try {
      const tasks = await this.getAvailableTasks();
      
      if (!tasks || tasks.length === 0) {
        this.logger.info(`No tasks available for wallet ${this.walletAddress}`);
        return {
          walletAddress: this.walletAddress,
          totalTasks: 0,
          completedCount: 0,
          failedCount: 0,
          totalPoints: 0,
          completedTasks: [],
          failedTasks: []
        };
      }
      
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
        this.logger.info(`Processing task: ${task.title} (Type: ${task.type})`);
        
        try {
          // Add a small delay between tasks to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 2000));

          const result = await this.verifyTask(task.id, task.type);
          
          if (result?.status === "COMPLETED") {
            const points = result.rewardRecords?.[0]?.appliedRewardQuantity || 0;
            this.logger.info(`✅ Task completed: ${task.title} (${points} points)`);
            completedTasks.push({
              title: task.title,
              type: task.type,
              points: points
            });
          } else {
            this.logger.warn(`❌ Failed to complete task: ${task.title}`);
            failedTasks.push({
              title: task.title,
              type: task.type
            });
          }
        } catch (taskError) {
          this.logger.error(`Error processing task - ${task.title}`, { 
            error: taskError.message
          });
          failedTasks.push({
            title: task.title,
            type: task.type,
            error: taskError.message
          });
        }
      }

      // Calculate total points earned
      const totalPoints = completedTasks.reduce((sum, task) => sum + (task.points || 0), 0);

      // Task summary
      const summary = {
        walletAddress: this.walletAddress,
        totalTasks: tasks.length,
        completedCount: completedTasks.length,
        failedCount: failedTasks.length,
        totalPoints: totalPoints,
        completedTasks,
        failedTasks
      };

      this.logger.info(`=== TASKS SUMMARY FOR ${this.walletAddress} ===`, {
        totalTasks: tasks.length,
        completedTasks: completedTasks.length,
        failedTasks: failedTasks.length,
        totalPoints: totalPoints
      });

      return summary;
    } catch (error) {
      this.logger.error(`Fatal error in task processing for ${this.walletAddress}`, { 
        error: error.message
      });
      
      return {
        walletAddress: this.walletAddress,
        error: error.message,
        totalTasks: 0,
        completedCount: 0,
        failedCount: 0,
        totalPoints: 0,
        completedTasks: [],
        failedTasks: []
      };
    }
  }
}

module.exports = TaskService;
