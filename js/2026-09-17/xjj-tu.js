// Cloudflare Worker:小姐姐图片随机源,同一个访问者 1 小时内不重复。
//
// 核心机制:用 Set-Cookie 把已播记录回传给浏览器。
//   - 浏览器访问 <img src> 时,Worker 随机选一张图,在响应里写
//     Set-Cookie: xjj-tu-seen=...(base64url 编码的已播位图 + 窗口起点 + 总数)。
//   - 用户点"下一个"(换 src 重新请求),浏览器自动带回 Cookie,
//     Worker 据此从未播过的里挑下一张。1 小时窗口内同一访问者不重复。
//   - 窗口过期(>1h)或 Cookie 损坏时,自动清零从头开始。
//   - 一轮播完(已播数 == 总数)立即重置,保证一定有图可给。
//
// 与视频 Worker(xjj-video.js)的关键区别:
//   - 图片不走 302 重定向,改为直接代理返回图片二进制 + 写 Cookie。
//     302 的 Set-Cookie 只作用于重定向目标域(img.oo.me.eu.org),
//     不是 Worker 域,浏览器不会保存,去重会失效。
//   - 图片走 img.oo.me.eu.org 代理(原代码逻辑),避开 raw.githubusercontent.com
//     直连被墙/慢的问题;代理仍返回 200,正常拉取图片二进制。
//
// 文件列表:
//   - 优先用 git trees API 一次取全量。一旦检测到 truncated=true(仓库文件
//     数逼近 1000),回退到 Contents API(按目录列,可分页)保证 tu 目录全量不漏。
//   - Cache API 缓存 10 分钟,避免每次请求都打 GitHub、也避开速率限制。
//   - 响应里的 tree.sha 即本次 commit 的 sha,直接拼 raw URL。
//
// Cookie 体积:
//   - 用位图(bitmask)记录已播索引,而非 JSON 数组。476 张只需 ~80 字节,
//     1000 张也才 ~130 字节,彻底摆脱浏览器 4096 字节的 Cookie 上限。
//
// 部署:
//   - 把 GITHUB_TOKEN 设为 Worker 的 Secret(仓库私有必须;公开可选)。
//   - Worker 必须部署在浏览器访问的同一域名(如 xjjtu.2091k.cn),
//     这样 <img> 请求的 Cookie 才会被带回。
//   - caches 是 Cloudflare 内置 Cache API,无需额外绑定。
//   - 注意首次部署时清一次 List cache(CACHE_TAG = xjj-tu-list-v2)。

const REPO = '2091k/githubfiles';
const FOLDER = 'tu';
// 后缀过滤:能否真正显示还取决于浏览器是否支持 webp/avif/heic
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|jfif|heic|avif)$/i;
const WINDOW_MS = 60 * 60 * 1000;   // 1 小时去重窗口
const LIST_TTL_MS = 10 * 60 * 1000; // 文件列表缓存 10 分钟
const CACHE_TAG = 'xjj-tu-list-v2'; // 版本号,改了缓存结构后换新 tag,避免读到旧缓存
const COOKIE_NAME = 'xjj-tu-seen';
const RAW_PREFIX = 'https://raw.githubusercontent.com/';
const PROXY_PREFIX = 'https://img.oo.me.eu.org/';
const GITHUB_PAGE_SIZE = 100;       // GitHub contents API 的 per_page 上限就是 100
const GITHUB_PAGE_MAX = 100;        // 安全上限,防止死循环

// 直接访问本 Worker(地址栏/超链接导航,不是 <img> 子资源)时怎么处理:
//   'proxy' : 302 到图床完整链接,如 https://img.oo.me.eu.org/2091k/.../tu/xxx.jpg
//             —— 地址栏显示图片完整地址;跨域跳转后浏览器去图床取图,
//                本 Worker 不会再收到请求,天然不会死循环。默认用这个。
//   'none'  : 不跳转,直接回图片字节(旧行为)
//
// ★ 绝对不要用"同域图片路径"跳转(曾经这样写过,是个死循环):
//   302 到 /2091k/.../tu/xxx.jpg 后,该请求对本 Worker 仍是"导航请求"
//   (路径变了但主机没变),于是又选一张图再 302 … 浏览器报
//   "redirect count exceeded",图永远显示不出来。
const NAV_REDIRECT = 'proxy';

// 图床同源前缀。重定向目标必须是"绝对地址且主机不同",否则就会回到上面的死循环。
function proxyOrigin() {
  try { return new URL(PROXY_PREFIX).origin; } catch (e) { return ''; }
}

// 有人在地址栏/链接里直接打开本 Worker 时(浏览器导航请求)判定为 true;
// <img src="..."> 是 no-cors 子资源请求,Sec-Fetch-Dest=image,不受影响。
function isDocumentNavigation(request) {
  const dest = request.headers.get('Sec-Fetch-Dest');
  const mode = request.headers.get('Sec-Fetch-Mode');
  if (dest === 'document' || mode === 'navigate') return true;
  if (dest) return false;                        // 有 Sec-Fetch-Dest 且不是 document → 子资源
  const accept = request.headers.get('Accept') || '';
  return accept.indexOf('text/html') !== -1;     // 老浏览器回退判断
}

function seenCookie(value) {
  return COOKIE_NAME + '=' + value + '; Path=/; Max-Age=' + WINDOW_MS + '; SameSite=Lax';
}

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const nav = isDocumentNavigation(request);

  // 1. 取图片文件列表(带 10 分钟缓存,自动处理 truncated)
  let files;
  try {
    files = await getImageList();
  } catch (e) {
    return new Response('Failed to fetch images from GitHub: ' + e.message, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  if (!files || files.length === 0) {
    return new Response('No images found in the folder', { status: 404 });
  }

  // 2. 从 Cookie 读已播记录(位图),做 1 小时去重
  const now = Date.now();
  const state = parseCookie(request.headers.get('Cookie') || '', now, files.length);

  // 3. 选图:从未播过的里随机挑;若一轮已播完,重置
  const exclude = state.played.size >= files.length ? new Set() : state.played;
  const picked = pickRandom(files, exclude);
  if (!picked) return new Response('No image available', { status: 500 });

  // 4. 更新已播记录(位图),生成新的 Cookie 值
  const nextPlayed = new Set(state.played);
  nextPlayed.add(picked.index);
  const nextWindowStart = state.played.size >= files.length ? now : state.windowStart;
  const nextCookieValue = encodeSeen(nextPlayed, nextWindowStart, files.length);

  const proxyUrl = picked.file.downloadUrl.replace(RAW_PREFIX, PROXY_PREFIX);

  // 5. 直接访问(地址栏/超链接):302 到图床上的图片完整地址。
  //    选图与去重逻辑和下面完全一致,所以"每次访问看到的是没看过的新图";
  //    也不下载图片二进制,省一次流量。
  //
  //    安全阀:只有当目标是"绝对地址 + 主机和本站不同"时才跳。
  //    万一日后有人把 NAV_REDIRECT 改成同域路径,这里会直接失败而不是
  //    陷入"跳到自己 → 又选图 → 又跳"的死循环。
  if (nav && NAV_REDIRECT !== 'none') {
    let target = null;
    if (NAV_REDIRECT === 'proxy') target = proxyUrl;
    try {
      const u = new URL(target);
      const sameHost = u.host === new URL(request.url).host;
      if (!u.protocol.startsWith('http') || sameHost) target = null;
    } catch (e) {
      target = null;
    }
    if (target) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: target,
          'Set-Cookie': seenCookie(nextCookieValue),
          'Cache-Control': 'no-store',
        },
      });
    }
    // 配置不合法:退化成直接出图,绝不死循环
  }

  // 6. 抓取图片二进制(走代理),直接返回 + 写 Cookie
  const img = await fetchImage(proxyUrl);
  if (!img || !img.body) {
    return new Response('Failed to fetch the image', { status: 500 });
  }

  const headers = {
    'Content-Type': img.contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // 把最新已播记录回传,浏览器下次请求自动带上
    'Set-Cookie': seenCookie(nextCookieValue),
  };
  if (img.contentLength) headers['Content-Length'] = img.contentLength;
  return new Response(img.body, { headers });
}

// ---------- 文件列表:git trees(主) + Contents(兜底) + Cache API ----------

async function getImageList() {
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

// 兜底路径:Contents API 按目录列(可分页),保证 tu 目录全量不漏。
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
    .filter((f) => f.type === 'file' && IMAGE_EXT.test(f.name))
    .map((f) => ({
      name: FOLDER + '/' + f.name,
      downloadUrl: f.download_url,
    }));
}

// trees 条目 → files(tree.sha 即 commit sha,拼 raw URL)
function buildFiles(tree) {
  return (tree.tree || [])
    .filter((t) => t.type === 'blob' && t.path.startsWith(FOLDER + '/'))
    .filter((t) => IMAGE_EXT.test(t.path.split('/').pop()))
    .map((t) => ({
      name: t.path,
      downloadUrl: RAW_PREFIX + REPO + '/' + tree.sha + '/' + t.path,
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

// ---------- 抓取图片(走代理) ----------

async function fetchImage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Cloudflare Workers' },
  });
  if (!res.ok) return null;

  // 代理/源站出错时可能回一个 HTML 或 JSON 错误页(状态仍是 200),
  // 若原样转发,浏览器会把"文字"当图片渲染 → 白板/裂图。
  // 这里做一次类型校验,明显不是图片就返回 null,让前端自动重试。
  const type = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type && !/^image\//.test(type)) return null;

  return {
    body: res.body,
    contentType: type || 'image/jpeg',
    contentLength: res.headers.get('Content-Length') || '',
  };
}

// ---------- Cookie:1 小时不重复(位图编码) ----------
// 编码:base64url(JSON { ws: 窗口起点 ms, n: 文件总数, b: 位图(base64url) })
// 位图:第 i 字节存第 [i*8, i*8+7] 个索引的已播位。
// 476 张 → 位图 60 字节,加 JSON 外壳约 80 字节;1000 张也才 ~130 字节。
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
    // 文件总数变了(新增或删除图片)→ 旧位图的位号已经对不上文件,必须清零,
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
