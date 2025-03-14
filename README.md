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


## 添加新的网站支持
在worpdpress的网站中function.php添加以下内容(rank_math_focus_keyword写入支持)
```PHP
<?php
function register_rank_math_focus_keyword() {
    register_meta( 'post', 'rank_math_focus_keyword', array(
        'show_in_rest' => true,
        'single' => true,
        'type' => 'string',
    ));
}
add_action( 'init', 'register_rank_math_focus_keyword' );

add_action('rest_api_init', function () {
    register_rest_field('post', 'rank_math_focus_keyword', array(
        'get_callback' => function ($post) {
            return get_post_meta($post['id'], 'rank_math_focus_keyword', true);
        },
        'update_callback' => function ($value, $post) {
            // 允许具有 'edit_posts' 权限的用户更新该字段
            if (!current_user_can('edit_posts', $post->ID)) {
                return new WP_Error('rest_forbidden', '无权编辑此字段', array('status' => 403));
            }
            return update_post_meta($post->ID, 'rank_math_focus_keyword', $value);
        },
        'schema' => array(
            'description' => 'Rank Math 焦点关键词',
            'type' => 'string',
        ),
    ));
});
```
![image](https://github.com/user-attachments/assets/d884975f-6f05-47ee-af3a-42ff5693eee4)
然后在google sheet文件中进行以下操作
1. 新建Sheet 重命名(可选)
2. 复制某个setting 重命名为`setting_`+ (new SheetName)
3. 需要修改其中的 `url` `username` `password` `img_endword` `metaUserPrompt` `contentSystemPrompt` `contentUserPrompt` 其他参数按需调整
4. 在发布前必须把工作Sheet**前置到第一位** 然后在其中框选需要发布文章的keywords 点击"发布"按钮并等待
5. 状态会更新到keywords右侧单元格中
6. 如果内容效果不满意 可通过调整Prompt测试
![image](https://github.com/user-attachments/assets/3784341b-d5f6-4e15-84bc-d5a120f4e63f)
