// 使用闭包封装状态，避免全局变量滥用
const shownImages = (function() {
  let images = [];
  return {
    add: function(index) {
      images.push(index);
    },
    reset: function() {
      images = [];
    },
    contains: function(index) {
      return images.includes(index);
    },
    length: function() {
      return images.length;
    }
  };
})();

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const repoUrl = 'https://api.github.com/repos/2091k/githubfiles/contents/tu';
  const token = GITHUB_TOKEN; // 注意：实际部署时应通过环境变量或安全方式获取

  const response = await fetch(repoUrl, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Cloudflare Workers'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    return new Response(`Failed to fetch images from GitHub: ${response.status} ${response.statusText}\n\n${errorText}`, {
      status: response.status
    });
  }

  const files = await response.json();
  const images = files.filter(file => file.type === 'file' && /\.(jpg|jpeg|png|gif|webp)$/.test(file.name));

  if (images.length === 0) {
    return new Response('No images found in the folder', { status: 404 });
  }

  if (shownImages.length() === images.length) {
    shownImages.reset();
  }

  let randomIndex;
  do {
    randomIndex = Math.floor(Math.random() * images.length);
  } while (shownImages.contains(randomIndex));

  shownImages.add(randomIndex);

  let randomImageUrl = images[randomIndex].download_url;
  randomImageUrl = randomImageUrl.replace('https://raw.githubusercontent.com/', 'https://jasu.oo.me.eu.org/https://raw.githubusercontent.com/');

  // 返回 302 重定向响应，跳转到图片地址
  return Response.redirect(randomImageUrl, 302);
}
