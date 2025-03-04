import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import axios from 'axios';

// Define the expected request body structure
interface WordPressPostRequest {
  url: string;
  username: string;
  password: string;
  keywords: string[];
  prompt: string;
  title?: string;
}

// Error handling function
const createErrorResponse = (message: string, statusCode: number = 400): APIGatewayProxyResult => {
  return {
    statusCode,
    body: JSON.stringify({ error: message }),
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true,
    },
  };
};

/**
 * Lambda function to create a WordPress post
 * Expects a JSON body with url, username, password, keywords, and prompt
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Validate that we have a body
    if (!event.body) {
      return createErrorResponse('Request body is required');
    }

    // Parse the request body
    let requestBody: WordPressPostRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (err) {
      return createErrorResponse('Invalid JSON in request body');
    }

    // Validate required parameters
    const { url, username, password, keywords, prompt } = requestBody;
    if (!url || !username || !password || !keywords || !prompt) {
      return createErrorResponse('Missing required fields: url, username, password, keywords, and prompt are required');
    }

    // Generate a title if one wasn't provided
    const title = requestBody.title || `Post about: ${keywords.join(', ')}`;

    // Create WordPress post content from the prompt 
    // (In a real implementation, you might use AI or templates to generate better content)
    const content = `
      <p>${prompt}</p>
      <p>Keywords: ${keywords.join(', ')}</p>
    `;

    // WordPress REST API endpoint for posts
    const wpEndpoint = `${url}/wp-json/wp/v2/posts`;

    // Create post via WordPress REST API
    const response = await axios.post(
      wpEndpoint,
      {
        title,
        content,
        status: 'publish', // Publish immediately, use 'draft' to save as draft
        categories: [], // Add category IDs if needed
        tags: keywords, // Use keywords as tags
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        auth: {
          username,
          password,
        },
      }
    );

    // Return successful response with the created post data
    return {
      statusCode: 201,
      body: JSON.stringify({
        message: 'Post created successfully',
        postId: response.data.id,
        postUrl: response.data.link,
      }),
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
    };
  } catch (error) {
    console.error('Error creating WordPress post:', error);
    
    // Handle specific API errors
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status || 500;
      const errorMessage = error.response?.data?.message || error.message;
      
      return createErrorResponse(`WordPress API error: ${errorMessage}`, statusCode);
    }
    
    // Generic error handling
    return createErrorResponse('Internal server error', 500);
  }
}; 