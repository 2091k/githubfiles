let shownImages = []; // 全局数组，存储已经显示过的图片索引

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const repoUrl = 'https://api.github.com/repos/2091k/githubfiles/contents/tu';
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
    return new Response(`Failed to fetch images from GitHub: ${response.status} ${response.statusText}\n\n${errorText}`, {
      status: response.status
    });
  }

  const files = await response.json();

  // 过滤出所有符合条件的图片
  const images = files.filter(file => file.type === 'file' && /\.(jpg|jpeg|png|gif|webp)$/.test(file.name));

  if (images.length === 0) {
    return new Response('No images found in the folder', { status: 404 });
  }

  // 如果所有图片都显示过了，清空记录重新开始
  if (shownImages.length === images.length) {
    shownImages = [];
  }

  let randomIndex;
  // 随机选择尚未显示过的图片索引
  do {
    randomIndex = Math.floor(Math.random() * images.length);
  } while (shownImages.includes(randomIndex));

  // 将选择的图片索引加入已显示列表
  shownImages.push(randomIndex);

  // 获取随机图片的URL
  let randomImageUrl = images[randomIndex].download_url;

  // 将 URL 中的 "https://raw.githubusercontent.com/" 替换为 "https://img.oo.me.eu.org/"
  randomImageUrl = randomImageUrl.replace('https://raw.githubusercontent.com/', 'https://jasu.oo.me.eu.org/https://raw.githubusercontent.com/');

  // 获取图片
  const imageResponse = await fetch(randomImageUrl, {
    headers: {
      'User-Agent': 'Cloudflare Workers'
    }
  });

  if (!imageResponse.ok) {
    return new Response('Failed to fetch the image', { status: 500 });
  }

  return new Response(imageResponse.body, {
    headers: {
      'Content-Type': imageResponse.headers.get('Content-Type') || 'image/jpeg'
    }
  });
}
