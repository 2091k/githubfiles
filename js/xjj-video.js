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
  const repoUrl = 'https://api.github.com/repos/2091k/githubfiles/contents/video';
  const token = GITHUB_TOKEN; // 考虑更安全的认证方式

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
  const videos = files.filter(file => file.type === 'file' && /\.(mp4|mkv|webm)$/.test(file.name));

  if (videos.length === 0) {
    return new Response('No videos found in the folder', { status: 404 });
  }

  if (shownVideos.getVideos().length === videos.length) {
    shownVideos.resetVideos();
  }

  let randomIndex;
  do {
    randomIndex = Math.floor(Math.random() * videos.length);
  } while (shownVideos.getVideos().includes(randomIndex));

  shownVideos.addVideo(randomIndex);

  let randomVideoUrl = videos[randomIndex].download_url;
  randomVideoUrl = randomVideoUrl.replace('https://raw.githubusercontent.com/', 'https://raw.githubusercontent.com/');

  const videoResponse = await fetch(randomVideoUrl, {
    headers: {
      'User-Agent': 'Cloudflare Workers'
    }
  });

  if (!videoResponse.ok) {
    return new Response('Failed to fetch the video', { status: 500 });
  }

  return new Response(videoResponse.body, {
    headers: {
      'Content-Type': videoResponse.headers.get('Content-Type') || 'video/mp4'
    }
  });
}
