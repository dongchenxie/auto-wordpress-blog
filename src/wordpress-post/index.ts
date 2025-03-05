import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import axios, { AxiosRequestConfig, AxiosError } from 'axios';
import { createLogger } from './logger';

// Request body structure definition
interface WordPressPostRequest {
  url: string;
  username: string;
  password: string;
  keywords: string[];
  prompt: string;
  title?: string;
  status?: 'publish' | 'draft' | 'pending' | 'private'; // Add status options
}

// WordPress post data interface
interface WordPressPostData {
  title: string;
  content: string;
  status: string;
  categories: number[];
  tags_input?: string[]; // 修改为tags_input
}

// Standardized API response format
interface ApiResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string | boolean>;
}

// Error handling function
const createErrorResponse = (message: string, statusCode = 400): APIGatewayProxyResult => {
  return formatResponse(statusCode, { error: message });
};

// Success response function
const createSuccessResponse = (data: any, statusCode = 200): APIGatewayProxyResult => {
  return formatResponse(statusCode, data);
};

// Response formatting function
const formatResponse = (statusCode: number, body: any): APIGatewayProxyResult => {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true,
    },
  };
};

// Validate request fields
const validateRequest = (request: WordPressPostRequest): string | null => {
  const { url, username, password, keywords, prompt } = request;
  
  if (!url) return 'WordPress URL(url) cannot be empty';
  if (!username) return 'Username(username) cannot be empty';
  if (!password) return 'Password(password) cannot be empty';
  if (!Array.isArray(keywords) || keywords.length === 0) return 'Keywords(keywords) must be a non-empty array';
  if (!prompt || prompt.trim() === '') return 'Content prompt(prompt) cannot be empty';

  // URL format validation
  try {
    new URL(url);
  } catch (e) {
    return 'Invalid WordPress URL format';
  }
  
  return null;
};

// WordPress API service
const wordPressService = {
  createPost: async (request: WordPressPostRequest): Promise<any> => {
    const { url, username, password, keywords, prompt, title, status = 'publish' } = request;
    
    // Generate content
    const postContent = `
      <p>${prompt}</p>
      <p>Keywords: ${keywords.join(', ')}</p>
    `;
    
    // Build request data
    const postData: WordPressPostData = {
      title: title || `About: ${keywords.join(', ')}`,
      content: postContent,
      status: status || 'draft', // 默认为草稿状态
      categories: [],
      tags_input: keywords.map(tag => tag.trim()).filter(Boolean), // 使用tags_input
    };
    
    // Build request configuration
    const config: AxiosRequestConfig = {
      headers: {
        'Content-Type': 'application/json',
      },
      auth: {
        username,
        password,
      },
      timeout: 10000, // 10 seconds timeout
    };
    
    // Send request
    const endpoint = `${url}/wp-json/wp/v2/posts`;
    return axios.post(endpoint, postData, config);
  }
};

/**
 * WordPress blog post Lambda function
 * Receives a request containing WordPress URL, authentication information, and content
 * Automatically publishes the article and returns the article ID and link
 */
export const handler = async (event: any): Promise<APIGatewayProxyResult> => {
  const logger = createLogger('wordpress-post', event);
  try {
    // 验证请求体是否存在
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Request body cannot be empty' }),
        headers: {
          'Content-Type': 'application/json'
        }
      };
    }

    // 验证请求体是否为有效JSON
    let requestBody: WordPressPostRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid request body JSON format' }),
        headers: {
          'Content-Type': 'application/json'
        }
      };
    }

    // 验证请求体是否包含所需字段并且不为空对象
    if (!requestBody || Object.keys(requestBody).length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Request body cannot be empty' }),
        headers: {
          'Content-Type': 'application/json'
        }
      };
    }

    // 验证请求字段
    const validationError = validateRequest(requestBody);
    if (validationError) {
      logger.error('Validation failed', { error: validationError, request: requestBody });
      return createErrorResponse(validationError, 400);
    }

    // 调用WordPress API
    logger.info('Calling WordPress API', { url: requestBody.url });
    const response = await wordPressService.createPost(requestBody);
    
    // 返回成功响应
    logger.info('Post created successfully', { postId: response.data.id });
    return createSuccessResponse({
      message: 'Article published successfully',
      postId: response.data.id,
      postUrl: response.data.link,
    }, 201);
  } catch (error) {
    // 处理API错误
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status || 500;
      
      // 提供基于错误类型的具体错误信息
      if (statusCode === 401) {
        logger.error('Authentication failed', { status: 401 });
        return createErrorResponse('WordPress authentication failed, please check username and password', 401);
      } else if (statusCode === 403) {
        logger.error('Permission denied', { status: 403 });
        return createErrorResponse('Insufficient permissions, user cannot publish articles', 403);
      } else if (statusCode === 404) {
        logger.error('Endpoint not found', { status: 404 });
        return createErrorResponse('WordPress API endpoint not found, please check the URL', 404);
      }
      
      // 一般API错误
      const errorMessage = (axiosError.response?.data as { message?: string })?.message || axiosError.message;
      logger.error('WordPress API error', { status: statusCode, message: errorMessage });
      return createErrorResponse(`WordPress API error: ${errorMessage}`, statusCode);
    }
    
    // 未知错误处理
    logger.error('Unexpected error', { error: String(error) });
    return createErrorResponse('Internal server error', 500);
  }
};