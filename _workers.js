// 获取环境变量
const githubToken = GITHUB_TOKEN;


const owner = '2091k';  // GitHub 用户名
const repo = 'githubfiles';  // 仓库名
const releaseId = '172925004';  // Release ID

// 监听 fetch 事件
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

// 处理请求的函数
async function handleRequest(request) {
  const { pathname } = new URL(request.url);

  if (pathname === '/') {
    return handleRootRequest(); // 返回 HTML 页面
  } else if (pathname === '/upload' && request.method === 'POST') {
    return handleUploadRequest(request); // 处理文件上传请求
  } else {
    return new Response('Not Found', { status: 404 });
  }
}

// 处理根路径请求的函数，返回 HTML 页面
function handleRootRequest() {
    const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>GITHUB临时文件上传平台</title>
      <!-- Bootstrap CSS -->
      <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">
      <style>
      #uploadingText {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        position: relative;
      }
    
      #uploadingText .progress-circle {
        width: 100px;
        height: 100px;
        border: 10px solid #007bff; /* 圆的边框颜色 */
        border-radius: 50%;
        border-top: 10px solid transparent; /* 上半部分透明以形成闭合圆形 */
        animation: spin 1s linear infinite;
      }
    
      #progressPercentage {
        position: absolute;
        font-size: 30px;
        font-weight: bold;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
      }
    
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
    
    </head>
    <body>
      <div class="container">
        <h1 class="mt-5">GitHUb Release</h1>
        <form id="uploadForm">
          <div class="form-group">
            <label for="fileInput">选择文件：</label>
            <input type="file" id="fileInput" name="file" class="form-control-file">
          </div>
          <button type="submit" class="btn btn-primary">上传文件</button>
        </form>
  
        <div id="uploadingText" class="mt-3" style="display: none;">
        <div class="progress-circle"></div>
        <div id="progressPercentage">0%</div>
        <span>文件上传中，请稍候...</span>
      </div>
      
  
        <div id="result" class="mt-3" style="display: none;">
          <h3 id="resultTitle"></h3>
          <p id="resultMessage"></p>
          <div id="uploadedFileContainer" style="display: none;">
            <h4>上传的文件：</h4>
            <p>文件下载链接：<input type="text" id="fileUrl" class="form-control" readonly></p>
            <button id="copyFileUrlBtn" class="btn btn-secondary mt-2">复制链接</button>
          </div>
        </div>
        <p style="font-size: 14px; text-align: center; position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; padding: 10px 0; border-top: 1px solid #ccc;">
        文件为临时存放平台,有效期30天  2024@一叶知秋-魏无羡 - 开源<a href="https://github.com/2091k/githubfiles" target="_blank" rel="noopener noreferrer" style="color: #007bff; text-decoration: none;">githubfiles</a>
    </p>
    
      </div>
  
      <!-- jQuery -->
      <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>
      <!-- Bootstrap JS -->
      <script src="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/js/bootstrap.bundle.min.js"></script>
      
      <script>
        $(document).ready(function() {
          $('#uploadForm').on('submit', function(event) {
            event.preventDefault();
            uploadFile();
          });
  
          async function uploadFile() {
            const fileInput = document.getElementById('fileInput');
            const file = fileInput.files[0];
            if (!file) {
              alert('请选择一个文件');
              return;
            }
          
            $('#uploadingText').show();
            $('#result').hide();
          
            const xhr = new XMLHttpRequest();
          
            xhr.upload.addEventListener('progress', function(event) {
              if (event.lengthComputable) {
                const percentComplete = Math.round((event.loaded / event.total) * 100);
                $('#progressPercentage').text(percentComplete + '%'); // 更新百分比
              }
            });
          
            xhr.addEventListener('load', function() {
              $('#uploadingText').hide();
              const response = JSON.parse(xhr.responseText);
          
              if (xhr.status === 201) {
                $('#resultTitle').text('上传成功！');
                $('#resultMessage').text('文件已成功上传到 GitHub Releases。');
                $('#fileUrl').val(response.data);
                $('#uploadedFileContainer').show();
              } else {
                $('#resultTitle').text('上传失败');
                $('#resultMessage').text(\`上传失败：\${response.error}\`);
                $('#uploadedFileContainer').hide();
              }
          
              $('#result').show();
            });
          
            xhr.addEventListener('error', function() {
              $('#uploadingText').hide();
              $('#resultTitle').text('上传失败');
              $('#resultMessage').text('上传过程中出现错误');
              $('#result').show();
              $('#uploadedFileContainer').hide();
            });
          
            const formData = new FormData();
            formData.append('file', file);
          
            xhr.open('POST', '/upload', true);
            xhr.send(formData);
          }
          
  
          // 复制文件链接
          $('#copyFileUrlBtn').click(function() {
            const fileUrl = document.getElementById('fileUrl');
            fileUrl.select();
            document.execCommand('copy');
            alert('文件链接已复制');
          });
        });
      </script>
    </body>
    </html>
    `;
    return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }
  
// 生成当前北京时间的时间戳
function getBeijingTimestamp() {
  const now = new Date();
  const beijingOffset = 8 * 60 * 60 * 1000; // 北京时间相对于UTC的偏移量
  const beijingTime = new Date(now.getTime() + beijingOffset);

  const year = beijingTime.getFullYear();
  const month = String(beijingTime.getMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getDate()).padStart(2, '0');
  const hours = String(beijingTime.getHours()).padStart(2, '0');
  const minutes = String(beijingTime.getMinutes()).padStart(2, '0');
  const seconds = String(beijingTime.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

// 生成随机小写字母组合
function getRandomString(length) {
  const charset = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    result += charset[randomIndex];
  }
  return result;
}

// 处理上传请求的函数
async function handleUploadRequest(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      throw new Error('未找到文件');
    }

    const fileName = file.name;
    const fileExtension = fileName.includes('.') ? fileName.split('.').pop() : ''; // 获取文件扩展名
    const newFileName = `${getBeijingTimestamp()}${getRandomString(6)}${fileExtension ? '.' + fileExtension : ''}`;

    // 读取文件内容为 ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // 将 ArrayBuffer 转为 Blob
    const blob = new Blob([arrayBuffer], { type: file.type });

    // GitHub Releases 上传 URL
    const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(newFileName)}`;

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': file.type, // 保留原始文件类型
        'User-Agent': 'Cloudflare Worker'
      },
      body: blob
    });

    const responseJson = await uploadResponse.json();

    if (uploadResponse.ok) {
      const downloadUrl = `https://jasu.oo.me.eu.org/${responseJson.browser_download_url}`;
      return new Response(JSON.stringify({ data: downloadUrl }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      console.error('GitHub 上传失败:', responseJson);
      return new Response(JSON.stringify({ error: 'GitHub 上传失败', details: responseJson }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('内部服务器错误:', error.message);
    return new Response(JSON.stringify({ error: '内部服务器错误', message: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
