import { handler } from './index';
import axios from 'axios';

// Mock axios module
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WordPress Post Lambda Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return an error if request body is missing', async () => {
    const event = {
      body: null
    } as any;

    const result = await handler(event);
    
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Request body is required');
  });

  it('should return an error if required fields are missing', async () => {
    const event = {
      body: JSON.stringify({
        url: 'https://example.com',
        // Missing username, password, keywords, and prompt
      })
    } as any;

    const result = await handler(event);
    
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Missing required fields');
  });

  it('should create a WordPress post successfully', async () => {
    // Mock the WordPress API response
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        id: 123,
        link: 'https://example.com/blog/test-post'
      }
    });

    const event = {
      body: JSON.stringify({
        url: 'https://example.com',
        username: 'test_user',
        password: 'test_password',
        keywords: ['test', 'blog'],
        prompt: 'This is a test blog post'
      })
    } as any;

    const result = await handler(event);
    
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body).message).toBe('Post created successfully');
    expect(JSON.parse(result.body).postId).toBe(123);
    
    // Verify axios was called with correct parameters
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://example.com/wp-json/wp/v2/posts',
      expect.objectContaining({
        title: expect.any(String),
        content: expect.any(String),
        status: 'publish',
        tags: ['test', 'blog']
      }),
      expect.objectContaining({
        auth: {
          username: 'test_user',
          password: 'test_password'
        }
      })
    );
  });

  it('should handle WordPress API errors', async () => {
    // Mock an API error response
    const errorResponse = {
      response: {
        status: 401,
        data: {
          message: 'Authentication failed'
        }
      }
    };
    mockedAxios.post.mockRejectedValueOnce(errorResponse);
    mockedAxios.isAxiosError.mockReturnValueOnce(true);

    const event = {
      body: JSON.stringify({
        url: 'https://example.com',
        username: 'wrong_user',
        password: 'wrong_password',
        keywords: ['test'],
        prompt: 'Test post'
      })
    } as any;

    const result = await handler(event);
    
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toContain('Authentication failed');
  });
}); 