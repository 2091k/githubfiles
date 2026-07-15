// 使用闭包封装状态，避免全局变量
const shownVideos = (function() {
  let videos = [];
  return {
    getVideos: function() {
      return videos;
    },
    addVideo: function(index) {
      if (!videos.includes(index)) {
        videos.push(index);
      }
    },
    resetVideos: function() {
      videos = [];
    }
  };
})();

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const repoUrl = 'https://api.github.com/repos/2091k/githubfiles/contents/tu';
  const token = GITHUB_TOKEN; // 环境变量配置Token

  // 请求GitHub文件列表
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
  // 筛选图片文件
  const images = files.filter(file => file.type === 'file' && /\.(jpg|jpeg|png|gif|webp)$/.test(file.name));

  if (images.length === 0) {
    return new Response('No images found in the folder', { status: 404 });
  }

  // 已展示全部则清空记录，重新随机
  if (shownVideos.getVideos().length === images.length) {
    shownVideos.resetVideos();
  }

  // 取未展示过的随机索引
  let randomIndex;
  do {
    randomIndex = Math.floor(Math.random() * images.length);
  } while (shownVideos.getVideos().includes(randomIndex));

  shownVideos.addVideo(randomIndex);

  // 直接替换域名：https://raw.githubusercontent.com/ → https://img.oo.me.eu.org/
  const originRawUrl = images[randomIndex].download_url;
  const proxyUrl = originRawUrl.replace('https://raw.githubusercontent.com/', 'https://img.oo.me.eu.org/');

  // 302重定向，地址栏展示替换后的图片链接
  return new Response(null, {
    status: 302,
    headers: {
      'Location': proxyUrl,
      'Cache-Control': 'no-cache' // 禁止缓存，每次刷新重新随机
    }
  });
}
