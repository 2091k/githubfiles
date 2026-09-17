// Cloudflare Worker:随机视频源,同一个访问者 1 小时内不重复。
//
// 核心机制:用 Set-Cookie 把已播记录回传给浏览器。
//   - 浏览器访问 <video src> 时,Worker 随机选一个视频,在响应里写
//     Set-Cookie: xjj-seen=...(base64url 编码的已播位图 + 窗口起点 + 总数)。
//   - 用户点"播放下一个"(换 src 重新请求),浏览器自动带回 Cookie,
//     Worker 据此从未播过的里挑下一个。1 小时窗口内同一访问者不重复。
//   - 窗口过期(>1h)或 Cookie 损坏时,自动清零从头开始。
//   - 一轮播完(已播数 == 总数)立即重置,保证一定有视频可给。
//
// 文件列表:
//   - 优先用 git trees API 一次取全量。一旦检测到 truncated=true(仓库文件
//     数逼近 1000),回退到 Contents API(按目录列,可分页)保证 video 目录全量不漏。
//   - Cache API 缓存 10 分钟,避免每次请求都打 GitHub、也避开速率限制。
//   - 响应里的 tree.sha 即本次 commit 的 sha,直接拼 raw URL。
//
// 视频流:
//   - 透传 Range 请求,让 <video> 能拖动进度、断点续播。
//   - 注意:上游若对 Range 请求回了 200(而不是 206),就把整段响应按 200
//     原样返回——绝不能自己贴上 Content-Range 硬当成 206,
//     否则浏览器会按错误的字节区间解析,表现为视频卡住不播/换了也不刷新。
//
// Cookie 体积:
//   - 用位图(bitmask)记录已播索引,而非 JSON 数组。341 个视频只需 ~60 字节,
//     1000 个也才 ~130 字节,彻底摆脱浏览器 4096 字节的 Cookie 上限。
//
// 部署:
//   - 把 GITHUB_TOKEN 设为 Worker 的 Secret(仓库私有必须;公开可选)。
//   - Worker 必须部署在浏览器访问的同一域名(如 xjjvideo.2091k.cn),
//     这样 <video> 请求的 Cookie 才会被带回。
//   - caches 是 Cloudflare 内置 Cache API,无需额外绑定。

const REPO = '2091k/githubfiles';
const FOLDER = 'video';
const VIDEO_EXT = /\.(mp4|mkv|webm)$/i;
const WINDOW_MS = 60 * 60 * 1000;   // 1 小时去重窗口
const LIST_TTL_MS = 10 * 60 * 1000; // 文件列表缓存 10 分钟
const CACHE_TAG = 'xjj-video-list-v2'; // 版本号,改了缓存结构后换新 tag,避免读到旧缓存
const COOKIE_NAME = 'xjj-seen';
const GITHUB_PAGE_SIZE = 100;       // GitHub contents API 的 per_page 上限就是 100
const GITHUB_PAGE_MAX = 100;        // 安全上限,防止死循环

// 有人在地址栏/链接里直接打开 /video 时(浏览器导航请求),不要直接把视频流当页面丢给他,
// 也不要把地址栏留在媒体路径上;302 回干净的主域名页面。
// <video src="/video"> 是 no-cors 子资源请求,Accept 不含 text/html,不受影响。
function isDocumentNavigation(request) {
  const dest = request.headers.get('Sec-Fetch-Dest');
  const mode = request.headers.get('Sec-Fetch-Mode');
  if (dest === 'document' || mode === 'navigate') return true;
  if (dest) return false;                        // 有 Sec-Fetch-Dest 且不是 document → 子资源
  const accept = request.headers.get('Accept') || '';
  return accept.indexOf('text/html') !== -1;     // 老浏览器回退判断
}

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // 0. 地址栏误打开媒体路径 → 302 回主域名视频页(地址栏保持干净)
  if (isDocumentNavigation(request)) {
    return new Response('', {
      status: 302,
      headers: { Location: '/', 'Cache-Control': 'no-store' },
    });
  }

  // 1. 取视频文件列表(带 10 分钟缓存,自动处理 truncated)
  let files;
  try {
    files = await getVideoList();
  } catch (e) {
    return new Response('Failed to fetch videos from GitHub: ' + e.message, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  if (!files || files.length === 0) {
    return new Response('No videos found in the folder', { status: 404 });
  }

  // 2. 从 Cookie 读已播记录(位图),做 1 小时去重
  const now = Date.now();
  const state = parseCookie(request.headers.get('Cookie') || '', now, files.length);

  // 3. 选视频:从未播过的里随机挑;若一轮已播完,重置
  const exclude = state.played.size >= files.length ? new Set() : state.played;
  const picked = pickRandom(files, exclude);
  if (!picked) return new Response('No video available', { status: 500 });

  // 4. 更新已播记录(位图),生成新的 Cookie 值
  const nextPlayed = new Set(state.played);
  nextPlayed.add(picked.index);
  const nextWindowStart = state.played.size >= files.length ? now : state.windowStart;
  const nextCookieValue = encodeSeen(nextPlayed, nextWindowStart, files.length);

  // 5. 抓取视频二进制流(透传 Range),直接返回 + 写 Cookie
  const rangeHeader = request.headers.get('Range');
  const video = await fetchVideo(picked.file.downloadUrl, rangeHeader);
  if (!video || !video.body) {
    return new Response('Failed to fetch the video', { status: 500 });
  }

  const headers = {
    'Content-Type': video.contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // 把最新已播记录回传,浏览器下次请求自动带上
    'Set-Cookie':
      COOKIE_NAME + '=' + nextCookieValue +
      '; Path=/; Max-Age=' + WINDOW_MS + '; SameSite=Lax',
  };

  // 只有上游确实回了 206 且带完整 Content-Range 时才透传 206
  if (video.isPartial && video.contentRange) {
    headers['Accept-Ranges'] = 'bytes';
    headers['Content-Range'] = video.contentRange;
    if (video.contentLength) headers['Content-Length'] = video.contentLength;
    return new Response(video.body, { status: 206, headers });
  }

  // 整段响应:声明支持 Range,并把长度带上,浏览器才能正常显示进度/拖动
  headers['Accept-Ranges'] = 'bytes';
  if (video.contentLength) headers['Content-Length'] = video.contentLength;
  return new Response(video.body, { headers });
}

// ---------- 文件列表:git trees(主) + Contents(兜底) + Cache API ----------

async function getVideoList() {
  const cache = await caches.open(CACHE_TAG);
  const cacheKey = listRequestUrl();

  const hit = await cache.match(cacheKey);
  if (hit && hit.headers.get('x-cached-at')) {
    const age = Date.now() - Number(hit.headers.get('x-cached-at'));
    if (age < LIST_TTL_MS) {
      try {
        const cached = await hit.json();
        if (cached && Array.isArray(cached.files)) return cached.files;
      } catch (e) { /* 缓存损坏,当成未命中,重新拉取 */ }
    }
  }

  let files;
  try {
    files = await fetchViaTrees();
  } catch (e) {
    files = await fetchViaContents();
  }
  if (!Array.isArray(files)) files = [];

  // 只有拿到非空列表才写缓存:否则一次 GitHub 抖动会把空结果缓存 10 分钟,
  // 期间所有请求都返回 404
  if (files.length > 0) {
    const out = new Response(JSON.stringify({ files }), {
      headers: {
        'Content-Type': 'application/json',
        'x-cached-at': String(Date.now()),
        'Cache-Control': 'public, max-age=600',
      },
    });
    await cache.put(cacheKey, out.clone());
  }
  return files;
}

// 主路径:git trees 递归取全量。若 truncated=true,抛错让调用方回退到 Contents。
async function fetchViaTrees() {
  const res = await fetch(listRequestUrl(), { headers: githubHeaders() });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(res.status + ' ' + res.statusText + '\n' + err);
  }
  const tree = await res.json();
  if (tree.truncated) {
    // 仓库文件数逼近 1000,trees 被截断 → 回退到 Contents API 按目录列
    throw new Error('git trees truncated, fallback to contents');
  }
  return buildFiles(tree);
}

// 兜底路径:Contents API 按目录列(可分页),保证 video 目录全量不漏。
// 注意 per_page 上限是 100:之前写 1000,导致 batch.length 永远小于 1000 而
// 分页判断失效,一路翻到 page>100 才停,白白打 100 次 GitHub API。
async function fetchViaContents() {
  const all = [];
  let page = 1;
  while (page <= GITHUB_PAGE_MAX) {
    const res = await fetch(
      'https://api.github.com/repos/' + REPO + '/contents/' + FOLDER +
      '?page=' + page + '&per_page=' + GITHUB_PAGE_SIZE,
      { headers: githubHeaders() }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error('contents ' + res.status + ' ' + res.statusText + '\n' + err);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < GITHUB_PAGE_SIZE) break; // 最后一页
    page++;
  }
  return all
    .filter((f) => f.type === 'file' && VIDEO_EXT.test(f.name))
    .map((f) => ({
      name: FOLDER + '/' + f.name,
      downloadUrl: f.download_url,
    }));
}

// trees 条目 → files(tree.sha 即 commit sha,拼 raw URL)
function buildFiles(tree) {
  return (tree.tree || [])
    .filter((t) => t.type === 'blob' && t.path.startsWith(FOLDER + '/'))
    .filter((t) => VIDEO_EXT.test(t.path.split('/').pop()))
    .map((t) => ({
      name: t.path,
      downloadUrl:
        'https://raw.githubusercontent.com/' + REPO + '/' + tree.sha + '/' + t.path,
    }));
}

function listRequestUrl() {
  return 'https://api.github.com/repos/' + REPO + '/git/trees/HEAD?recursive=1';
}

function githubHeaders() {
  const h = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Cloudflare Workers',
  };
  // GITHUB_TOKEN 未配置时不要发 "token undefined",直接匿名请求
  if (typeof GITHUB_TOKEN !== 'undefined' && GITHUB_TOKEN) {
    h.Authorization = 'token ' + GITHUB_TOKEN;
  }
  return h;
}

// ---------- 抓取单个视频(支持 Range) ----------

async function fetchVideo(downloadUrl, rangeHeader) {
  const headers = { 'User-Agent': 'Cloudflare Workers' };
  if (rangeHeader) headers['Range'] = rangeHeader;

  const res = await fetch(downloadUrl, { headers });
  if (!res.ok && res.status !== 206) return null;

  const type = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  return {
    body: res.body,
    // 上游偶尔会把二进制当 text/plain 回;可以接受,但不能把 HTML 错误页当视频
    contentType: /^video\//.test(type) ? type : 'video/mp4',
    isPartial: res.status === 206,
    contentRange: res.headers.get('Content-Range') || '',
    contentLength: res.headers.get('Content-Length') || '',
  };
}

// ---------- Cookie:1 小时不重复(位图编码) ----------
// 编码:base64url(JSON { ws: 窗口起点 ms, n: 文件总数, b: 位图(base64url) })
// 位图:第 i 字节存第 [i*8, i*8+7] 个索引的已播位。
// 341 个视频 → 位图 43 字节,加 JSON 外壳约 60 字节;1000 个也才 ~130 字节。
// Max-Age = 1h;过期后浏览器不再回传,服务端自动从头开始。
// 注意:索引基于"当前缓存的文件列表顺序"。缓存刷新后顺序可能变化,
// 旧位图可能错位——可接受,最坏"偶尔重复一次",下一轮纠正。

function parseCookie(cookieHeader, now, total) {
  const fresh = () => ({ windowStart: now, played: new Set(), total: total });
  if (!cookieHeader) return fresh();
  const m = cookieHeader.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]*)'));
  if (!m) return fresh();
  try {
    const json = JSON.parse(b64urlToJsonStr(m[1]));
    const ws = Number(json.ws) || 0;
    const n = Number(json.n) || 0;
    // 窗口过期 / 时间戳异常 → 重新开始
    if (!ws || ws > now || now - ws > WINDOW_MS) return fresh();
    // 文件总数变了(新增或删除视频)→ 旧位图的位号已经对不上文件,必须清零,
    // 否则会错位,出现"刚看过的又出现"
    if (n !== total) return fresh();
    const bitmap = json.b ? bitmapToBin(json.b) : '';
    const played = bitmapToSet(bitmap, total);
    return { windowStart: ws, played: played, total: n };
  } catch (e) {
    return fresh();
  }
}

function encodeSeen(playedSet, windowStart, total) {
  const byteLen = Math.ceil(total / 8);
  const bytes = new Uint8Array(byteLen);
  for (const idx of playedSet) {
    if (idx >= 0 && idx < total) bytes[idx >> 3] |= 1 << (idx & 7);
  }
  let bin = '';
  for (let i = 0; i < byteLen; i++) bin += String.fromCharCode(bytes[i]);
  const bitmapB64url = b64urlEncodeBinary(bin);
  return b64urlEncodeJson(JSON.stringify({ ws: windowStart, n: total, b: bitmapB64url }));
}

// 位图 → 已播索引集合。位图比 total 短(列表变短/Cookie 被截断)时按缺失处理,
// charCodeAt 越界得到 NaN,位运算会归 0,不会抛错。
function bitmapToSet(bitmapBin, total) {
  const s = new Set();
  for (let i = 0; i < total; i++) {
    const byte = bitmapBin.charCodeAt(i >> 3);
    if (byte & (1 << (i & 7))) s.add(i);
  }
  return s;
}

function pickRandom(files, exclude) {
  if (files.length === 0) return null;
  // 全播过 → 不限制,随便选
  if (exclude.size >= files.length) {
    const idx = Math.floor(Math.random() * files.length);
    return { index: idx, file: files[idx] };
  }
  let candidate;
  do {
    candidate = Math.floor(Math.random() * files.length);
  } while (exclude.has(candidate));
  return { index: candidate, file: files[candidate] };
}

// ---------- 编码工具 ----------
// 两种 base64url,用途区分清楚:
//  - b64urlEncodeJson / b64urlToJsonStr:对 JSON 字符串(ASCII 为主),
//    先 encodeURIComponent 处理非 ASCII,再 btoa;解码对称还原。
//  - b64urlEncodeBinary / bitmapToBin:对 raw 二进制串,直接 btoa,
//    不做 encodeURIComponent(否则会破坏原始字节)。

function b64urlEncodeJson(s) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlToJsonStr(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

function b64urlEncodeBinary(bin) {
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 把 base64url 字符串解回原始二进制串。
// atob 要求标准 base64(+/+ = 填充),base64url 把 +/ 换成 -_、常去掉 =,
// 需先还原再 atob。还原后返回 raw 二进制串(字符 0-255),适合 charCodeAt 取位。
function bitmapToBin(b64urlStr) {
  let s = b64urlStr.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}
