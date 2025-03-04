# WordPress Post Lambda Function

A TypeScript AWS Lambda function that automatically creates posts on a WordPress site.

## Features

- Makes POST requests to WordPress REST API
- Creates new blog posts with provided content
- Authenticates with WordPress credentials
- Handles error cases and provides meaningful responses
- Automatically deploys to AWS Lambda using GitHub Actions

## Setup and Deployment

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Build the TypeScript code:
   ```
   npm run build
   ```
4. Run tests:
   ```
   npm run test
   ```
5. To deploy to AWS Lambda, push to the `main` branch. The GitHub Actions workflow will automatically build and deploy the function.

## AWS Lambda Configuration

Ensure you have the following AWS secrets configured in your GitHub repository:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

## Usage

Send a POST request to the Lambda function with the following JSON body:

```json
{
  "url": "https://your-wordpress-site.com",
  "username": "your_wordpress_username",
  "password": "your_wordpress_application_password",
  "keywords": ["keyword1", "keyword2"],
  "prompt": "Your blog post content goes here.",
  "title": "Optional custom title (will be auto-generated if omitted)"
}
```

### Response Format

Successful response:
```json
{
  "message": "Post created successfully",
  "postId": 123,
  "postUrl": "https://your-wordpress-site.com/blog/post-slug"
}
```

Error response:
```json
{
  "error": "Error message details"
}
```

## Notes on WordPress Authentication

For security reasons, it's recommended to use WordPress Application Passwords instead of your main account password. You can create an application password in your WordPress admin panel under Users > Profile > Application Passwords.

## Local Development

For local development and testing:

1. Install dependencies:
   ```
   npm install
   ```

2. Run tests:
   ```
   npm run test
   ```

3. Start development:
   ```
   npm run build -- --watch
   ``` 