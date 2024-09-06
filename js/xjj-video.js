let shownVideos = []; // 全局数组，存储已经显示过的视频索引

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const repoUrl = 'https://api.github.com/repos/2091k/githubfiles/contents/video';
  const token = GITHUB_TOKEN; 

  const response = await fetch(repoUrl, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Cloudflare Workers'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    return new Response(`Failed to fetch videos from GitHub: ${response.status} ${response.statusText}\n\n${errorText}`, {
      status: response.status
    });
  }

  const files = await response.json();

  // 过滤出所有符合条件的视频文件
  const videos = files.filter(file => file.type === 'file' && /\.(mp4|mkv|webm)$/.test(file.name));

  if (videos.length === 0) {
    return new Response('No videos found in the folder', { status: 404 });
  }

  // 如果所有视频都已经显示过，清空记录重新开始
  if (shownVideos.length === videos.length) {
    shownVideos = [];
  }

  let randomIndex;
  // 随机选择尚未显示过的视频索引
  do {
    randomIndex = Math.floor(Math.random() * videos.length);
  } while (shownVideos.includes(randomIndex));

  // 将选择的视频索引加入已显示列表
  shownVideos.push(randomIndex);

  // 获取随机选择的视频文件的URL
  let randomVideoUrl = videos[randomIndex].download_url;

  // 将 URL 中的 "https://raw.githubusercontent.com/" 替换为 "https://jasu.oo.me.eu.org/"
  randomVideoUrl = randomVideoUrl.replace('https://raw.githubusercontent.com/', 'https://jasu.oo.me.eu.org/https://raw.githubusercontent.com/');

  // 获取视频文件
  const videoResponse = await fetch(randomVideoUrl, {
    headers: {
      'User-Agent': 'Cloudflare Workers'
    }
  });

  if (!videoResponse.ok) {
    return new Response('Failed to fetch the video', { status: 500 });
  }

  // 返回视频文件作为响应
  return new Response(videoResponse.body, {
    headers: {
      'Content-Type': videoResponse.headers.get('Content-Type') || 'video/mp4'
    }
  });
}
