// Cloudflare Worker(ES Module 格式):主域名唯一入口
//
// 一个文件干完所有事,不再需要 jasu / index 两份:
//   /          /?type=video / ?type=v   -> 视频页(本文件渲染)
//   /?type=png / ?type=img   / ?type=tu -> 图片页(本文件渲染)
//   /tu                                 -> 反代 xjjtu.2091k.cn(图片源,写去重 Cookie)
//   /video                              -> 反代 xjjvideo.2091k.cn(视频源,透传 Range)
//   其它路径                            -> 反代 SITE_FALLBACK(可选,默认关闭见下)
//
// ★ 格式:ES Module(export default)。与 xjj-tu.js / xjj-video.js 的
//   Service Worker(addEventListener)格式不同,三者必须各自独立部署。
//
// ★ 为什么不再有第二个页面 Worker:
//   以前 jasu 内嵌一份 HTML、index.php.js 内嵌一份,两份并存 →
//   改了 A 忘了 B,就会出现"某个入口还是旧页面"。现在页面只此一份。
//
// ★ 媒体为什么必须由本文件接管:
//   页面里媒体用相对路径(/tu、/video),主域名下这两个路径必须指向真正的媒体
//   Worker,而不是本文件自己(否则会返回页面 HTML)。
//
// ★ 部署要点(重要,踩过一次坑):
//   - 必须同时接管 / 和 ?type=video / ?type=png 三条入口(同一条路由或都指过来),
//     否则带后缀的地址会落到别的 Worker 上,拿到旧页面。
//   - 页面响应带 Cache-Control: no-store。否则改完前端脚本,浏览器还在跑旧页面,
//     看着就是"改了没用"。
//
// 三条硬规矩(别再改回去):
//   1) 换图/换视频必须"新 URL(?r=随机) + media.load()"。
//      固定 URL 赋给 src 属于同一次资源加载,浏览器不会重新请求
//      —— 这就是"点播放下一个没反应 / 只是从头再播"的根因。
//   2) 媒体 URL 只允许出现在 src / href 里,绝不能被"导航"过去。
//      一旦地址栏变成 /tu、/video,浏览器就在直接看媒体,页面脚本不再执行。
//   3) 视频 #player 用 max-width/max-height,不要 width:100%。
//      width:100% 会把 <video> 元素撑成 1.73:1 的"长条",竖屏视频只画中间一条,
//      原生进度条跟着元素宽度铺满整屏,看起来"跑到画面外面"。
//
// 构建标记:page-build: 2026-02-20-r6 (单文件入口版)

const BUILD = 'page-build: 2026-02-20-r10 (单文件入口版)';

const PAGE_HEADERS = {
  'Content-Type': 'text/html;charset=UTF-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Accept-Encoding',
};

// 媒体是否走同域相对路径(线上形态):/tu、/video 由本文件反代到下面的两个源
const MEDIA_BASE = '';
const IMAGE_ORIGIN = 'https://xjjtu.2091k.cn/';
const VIDEO_ORIGIN = 'https://xjjvideo.2091k.cn/';

// 需要反代到别处的其它路径(通常没有)。留空字符串 = 关闭,返回 404。
// 如果哪天还想把主站其它内容挂到主域名下,把它填成 'https://xjjweb.2091k.cn' 即可。
const SITE_FALLBACK = '';

// 这些头是浏览器发给本域名的,转发给上游会干扰渲染 / 防盗链判断 / 回环检测
const STRIP_HEADERS = ['host', 'referer', 'origin', 'cf-connecting-ip', 'cf-ipcountry', 'cdn-loop'];

export default {
  async fetch(request) {
    const url = new URL(request.url);

    try {
      // ---------- 1. 媒体:反代到对应源站(写去重 Cookie / 透传 Range) ----------
      if (matchRootPath(url.pathname, '/tu')) {
        return await proxyRequest(IMAGE_ORIGIN, request);
      }
      if (matchRootPath(url.pathname, '/video')) {
        return await proxyRequest(VIDEO_ORIGIN, request);
      }

      // ---------- 2. 页面 ----------
      const type = (url.searchParams.get('type') || '').trim().toLowerCase();
      if (type === 'png' || type === 'img' || type === 'tu' || type === 'image') {
        return new Response(imageHtml(), { headers: PAGE_HEADERS });
      }
      if (type === 'video' || type === 'v' || url.pathname === '/') {
        return new Response(videoHtml(), { headers: PAGE_HEADERS });
      }

      // ---------- 3. 其它路径 ----------
      if (SITE_FALLBACK) {
        return await proxyRequest(SITE_FALLBACK + url.pathname + url.search, request);
      }
      return new Response(
        '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1"><title>404</title></head>' +
        '<body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding-top:40vh">' +
        '页面不存在<br><br><a href="/" style="color:#FFC0CB">返回视频页</a> &nbsp;|&nbsp; ' +
        '<a href="/?type=png" style="color:#FFC0CB">图片页</a></body></html>',
        { status: 404, headers: PAGE_HEADERS }
      );
    } catch (err) {
      return new Response(
        '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1"><title>访问出错</title></head>' +
        '<body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding-top:35vh">' +
        '<h2>源站连接失败或程序异常</h2>' +
        '<p style="opacity:.7">' + escapeHtml(err && err.message ? err.message : '未知错误') + '</p>' +
        '<p><a href="/" style="color:#FFC0CB">返回视频页</a> &nbsp;|&nbsp; ' +
        '<a href="/?type=png" style="color:#FFC0CB">图片页</a></p>' +
        '</body></html>',
        { status: 502, headers: PAGE_HEADERS }
      );
    }
  },
};

// ---------- 路由与代理工具 ----------

// 精确匹配一级路径:/tu 命中,/tu2、/tuxxx 不命中
function matchRootPath(pathname, seg) {
  return pathname === seg || pathname.startsWith(seg + '/');
}

// 浏览器导航请求(地址栏/超链接)。<img>、<video> 子资源请求不算。
// 注意:内部反代时会把原始请求头带过去,媒体 Worker 自己也有同样的守卫,
// 所以地址栏误开 /tu、/video 会被那边 302 回干净页面。
function isDocumentNavigation(request) {
  const dest = request.headers.get('Sec-Fetch-Dest');
  const mode = request.headers.get('Sec-Fetch-Mode');
  if (dest === 'document' || mode === 'navigate') return true;
  if (dest) return false;
  const accept = request.headers.get('Accept') || '';
  return accept.indexOf('text/html') !== -1;
}

async function proxyRequest(target, request) {
  const url = new URL(request.url);

  // 地址栏直接打开媒体路径 → 302 回对应页面,别把地址栏留在 /tu、/video
  if (isDocumentNavigation(request)) {
    const back = matchRootPath(url.pathname, '/tu') ? '/?type=png' : '/';
    return new Response(null, {
      status: 302,
      headers: { Location: back, 'Cache-Control': 'no-store' },
    });
  }

  const headers = new Headers(request.headers);
  for (const h of STRIP_HEADERS) headers.delete(h);

  const method = request.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const res = await fetch(new Request(target, {
    method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',   // 跳转由我们显式转交浏览器,避免拿到 opaqueredirect
  }));

  if (res.status === 0 || (res.status >= 300 && res.status < 400)) {
    const loc = res.headers.get('location');
    if (loc) {
      return new Response(null, { status: 302, headers: { Location: loc, 'Cache-Control': 'no-store' } });
    }
    return new Response('媒体源返回了无效跳转', {
      status: 502,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  }

  const out = new Headers(res.headers);
  // 让浏览器知道可以按字节区间取(视频拖动进度条用)
  if (!out.has('Accept-Ranges') && /video\//.test(out.get('Content-Type') || '')) {
    out.set('Accept-Ranges', 'bytes');
  }
  return new Response(res.body, { status: res.status, headers: out });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------- 图片页 ----------------
function imageHtml() {
  return `<!DOCTYPE html>
<!-- ${BUILD} | 图片页 -->
<html lang="zh-CN">
<head>
    <meta charSet="utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1" />
    <meta http-equiv="Cache-Control" content="no-transform" />
    <meta http-equiv="Cache-Control" content="no-siteapp" />
    <meta name="referrer" content="never">
    <meta name="renderer" content="webkit" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>小姐姐图片在线随机播放 - 魏无羡</title>
    <style>
      ${css()}
      /* ---------- 图片页专属样式 ---------- */
      /* touch-action: manipulation 去掉移动端点按的 300ms 延迟,
         让"点图放大"第一时间响应,不给任何定时器插队的机会 */
      #player {
        cursor: zoom-in;
        -webkit-user-drag: none;
        touch-action: manipulation;
      }
      #hint {
        position: fixed;
        left: 50%;
        bottom: 76px;
        transform: translateX(-50%);
        max-width: 90vw;
        padding: 6px 14px;
        border-radius: 16px;
        background: rgba(0,0,0,.6);
        color: #fff;
        font-size: 14px;
        line-height: 1.4;
        text-align: center;
        pointer-events: none;
        opacity: 0;
        transition: opacity .2s;
      }
      #hint.show { opacity: 1; }
      /* 图片放大弹窗 */
      #imgModal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0,0,0,0.92);
        z-index: 9999;
        cursor: grab;
        overflow: hidden;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }
      #imgModal.active {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #imgModal.dragging { cursor: grabbing; }
      /* 放大弹窗里的画布:显示的是"当前那张图的像素副本"。
         用 canvas 而不是 <img>,是为了彻底避免"再请求一次图片" —— 图片 Worker
         每收到一次请求就换一张没看过的图,只要重新请求,放大就会变成另一张图。 */
      #modalImg {
        max-width: 95vw;
        max-height: 95vh;
        transition: transform 0.1s ease-out;
        transform-origin: center center;
        will-change: transform;
        -webkit-user-drag: none;
        user-drag: none;
        touch-action: none;
      }
      #imgModal.active #modalImg {
        display: block;
      }
      #closeModal {
        position: fixed;
        top: 20px;
        right: 30px;
        color: #fff;
        font-size: 40px;
        background: transparent;
        border: none;
        cursor: pointer;
        z-index: 10000;
      }
    </style>
</head>
<body>
  <section id="main">
    <img id="player" alt="小姐姐图片" draggable="false">
  </section>
  <section id="buttons">
    <a href="/"><button id="qh" type="button">切换视频</button></a>
    <button id="next" type="button">下一个</button>
  </section>
  <div id="hint"></div>

  <!-- 图片放大弹窗:用 canvas 显示"当前这张图的像素副本",
       这样放大绝不会再向图片 Worker 发请求(它每收到一次请求就换一张没看过的图) -->
  <div id="imgModal">
    <button id="closeModal" type="button">×</button>
    <canvas id="modalImg"></canvas>
  </div>

  <script>
// 图片页:
//  "下一个"= 换一个带随机参数的 URL 重新赋值给 <img>.src(强制新请求).
//  以前用的是 onclick="location.reload()":整页重载、还会把 /tu 这种媒体路径
//  推进地址栏,既慢又乱.现在只换 URL,页面不跳转.
(function () {
  var MEDIA_TU = '${MEDIA_BASE}/tu';   // 媒体地址(相对同域)
  var player = document.getElementById('player');
  var hintEl = document.getElementById('hint');
  var hintTimer = null;
  var state = 'loading';   // loading | shown | failed
  var modalCanvas = document.getElementById('modalImg');   // 弹窗画布(像素副本)

  function showHint(text) {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    if (!text) { hintEl.classList.remove('show'); return; }
    hintEl.textContent = text;
    hintEl.classList.add('show');
  }

  // 随机参数:每次都是新 URL,浏览器必须重新请求(去重靠 Worker 写的 Cookie)
  function nextImageUrl() {
    return MEDIA_TU + '?r=' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
  }

  // 只有两种情况会换图:用户点「下一个」,或首屏第一次加载。
  // 关键:这里绝不做"自动失败重试"——定时器一旦挂着,就可能在用户点图放大的
  // 前后触发,手机上表现就是"点一下图,图变成另一张了"。图片页宁可不自动重试。
  function next() {
    state = 'loading';
    closeModal();                  // 换图时先收起弹窗并释放上一份本地副本
    player.src = nextImageUrl();   // 换图后由 <img> 的 load 事件再置为 shown
  }

  player.addEventListener('load', function () {
    state = 'shown';
    copyToModalCanvas();     // 图一显示出来就立刻复制像素,后面放大用这份副本
    showHint('');
  });

  player.addEventListener('error', function () {
    state = 'failed';
    showHint('图片加载失败,请点「下一个」');
  });

  document.getElementById('next').addEventListener('click', next);

  // 把"屏幕上这张已经显示出来的图"的像素复制到弹窗画布上。
  //   - 源与页面同源,drawImage + 画布读取不会被跨域污染
  //   - 复制的是"已经解码好的像素",不产生任何网络请求
  // 这是唯一能保证"放大时不会拿到另一张图"的做法:
  // 图片 Worker 的语义是"每收到一次请求就换一张没看过的图",所以任何
  // "再请求一次图片"的方案(重新赋 src / fetch / cloneNode)都会换图。
  function copyToModalCanvas() {
    try {
      if (!modalCanvas || !player.naturalWidth || !player.naturalHeight) return false;
      var w = player.naturalWidth;
      var h = player.naturalHeight;
      if (modalCanvas.width !== w || modalCanvas.height !== h) {
        modalCanvas.width = w;
        modalCanvas.height = h;
      }
      var ctx = modalCanvas.getContext('2d');
      if (!ctx) return false;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(player, 0, 0, w, h);
      return true;
    } catch (e) {
      return false;   // 画布不可用/被污染:退化为"不放大",但绝不换图
    }
  }

  // 首屏:脚本就绪后再发起,避免和"切换视频"的导航抢带宽
  next();

  // ---------- 点击放大 / 拖动 / 滚轮与双指缩放 ----------
  //
  // "图片乱跑"的三个真凶(全部在此修掉):
  //   1) 浏览器原生图片拖拽:按住图拖动时,浏览器自己也在搬那张图(还带半透明残影),
  //      和我们的 transform 打架 -> 图的位移翻倍、乱跳。
  //      对策:draggable=false + dragstart preventDefault + CSS -webkit-user-drag:none。
  //   2) 缩放锚点符号写反:元素是"居中定位 + transform-origin:center center",
  //      正确形式是 pos = (cursor - center) - (cursor - center - posOld) * ratio,
  //      写成 (center - cursor) - ... 会让图在缩放时往一边飘。
  //   3) 双指捏合用"上一帧距离"递推,手指间距抖动会累积成漂移。
  //      对策:记录手势开始时的距离/缩放,每帧从"手势起点"绝对计算。
  var modal = document.getElementById('imgModal');
  var modalImg = document.getElementById('modalImg');
  var closeBtn = document.getElementById('closeModal');

  var scale = 1, posX = 0, posY = 0;
  var dragging = false, dragX = 0, dragY = 0, dragPosX = 0, dragPosY = 0;
  var ZOOM_STEP = 0.2, MAX_SCALE = 5, MIN_SCALE = 0.5;
  var touchMode = false;      // 正在双指手势(声明提前,pointerdown 会读它)
  var pinchStartDist = 0, pinchStartScale = 1;

  function round2(n) { return Math.round(n * 100) / 100; }
  function updateTransform() {
    modalImg.style.transform =
      'translate(' + round2(posX) + 'px,' + round2(posY) + 'px) scale(' + round2(scale) + ')';
  }

  // 围绕屏幕上某个点缩放:该点对应的图片内容保持不动
  //
  // 推导(元素中心固定在 transform-origin 处,pos 是元素中心相对它的位移):
  //   图片坐标 u = (X - center - pos) / scale
  //   要求光标 X=cx 处的 u 缩放前后不变:
  //     (d - posOld) / scaleOld = (d - posNew) / scaleNew ,  d = cx - center
  //   => posNew = d - (d - posOld) * ratio ,  ratio = scaleNew / scaleOld
  function zoomAt(cx, cy, nextScale) {
    nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
    if (nextScale === scale) return;
    var r = modalImg.getBoundingClientRect();
    var centerX = r.left + r.width / 2;   // 元素实际中心(已含当前平移与缩放)
    var centerY = r.top + r.height / 2;
    var ratio = nextScale / scale;
    var dx = cx - centerX;
    var dy = cy - centerY;
    posX = dx - (dx - posX) * ratio;
    posY = dy - (dy - posY) * ratio;
    scale = nextScale;
    updateTransform();
  }

  function endDrag() {
    dragging = false;
    modal.classList.remove('dragging');
  }
  function closeModal() {
    if (!modal) return;
    modal.classList.remove('active');
    modal.classList.remove('dragging');
    if (dragging) endDrag();
    // 画布里的像素副本保留着(下次打开还要用),只复位变换
    scale = 1;
    posX = 0;
    posY = 0;
    if (modalImg) modalImg.style.transform = '';
  }

  // 彻底禁掉原生图片拖拽(否则拖图会和我们的拖动打架)
  modalImg.draggable = false;
  modalImg.addEventListener('dragstart', function (e) { e.preventDefault(); });

  // 打开放大弹窗
  //
  // 核心约束:放大绝不能导致任何一次新的图片请求。
  // 图片 Worker 的语义是"每收到一次请求就换一张没看过的图",所以只要弹窗
  // 重新请求一次(重新赋 src / fetch / cloneNode 都一样),用户看到的就是另一张图。
  // 因此弹窗用 <canvas>:里面是"当前这张图已经解码好的像素副本",全程离线。
  function openModal() {
    if (!modalCanvas) return false;
    if (!(player.naturalWidth && player.complete)) return false;
    // 每次打开都重新复制一次像素(换图后 load 也会复制,这里兜底)
    if (!copyToModalCanvas()) { showHint('无法放大这张图,请点「下一个」'); return false; }

    scale = 1;
    posX = 0;
    posY = 0;
    updateTransform();
    modal.classList.add('active');
    return true;
  }


  player.addEventListener('click', function (e) {
    e.stopPropagation();
    // 以 element 的真实状态为准:只要已经解码好,就直接放大。
    // (不能只信 state:手机端 load 事件偶尔会比第一次点击还晚到,
    //  那样第一次点会走到"等待"分支,体验上就像"点了没反应/闪一下")
    if (player.naturalWidth && player.complete) {
      state = 'shown';
      openModal();
      return;
    }
    if (state === 'failed') { showHint('图片加载失败,请点「下一个」'); return; }
    // 确实还在加载:等这一张 load 完再弹,期间只提示一次,不动 src
    showHint('图片加载中…');
    player.addEventListener('load', function once() {
      player.removeEventListener('load', once);
      showHint('');
      if (!modal.classList.contains('active')) openModal();
    });
    player.addEventListener('error', function onceErr() {
      player.removeEventListener('error', onceErr);
      showHint('图片加载失败,请点「下一个」');
    });
  });

  closeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    closeModal();
  });
  modal.addEventListener('click', function (e) {
    if (e.target === modal) { e.stopPropagation(); closeModal(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  // ---------- 鼠标:滚轮缩放 ----------
  modal.addEventListener('wheel', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var step = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    zoomAt(e.clientX, e.clientY, scale + step);
  }, { passive: false });

  // ---------- 触摸:单指拖动 + 双指捏合 ----------
  //
  // 统一用 Pointer Events 处理(现代手机/平板都有):
  //   - 单指:拖动
  //   - 双指:捏合缩放,围绕两指中点(从手势起点绝对计算,不逐帧递推 -> 不漂移)
  // 这里必须自己维护"活跃指针表",不能用 e.isPrimary 过滤第二根手指,
  // 否则第二根手指的事件被丢掉,双指就永远捏不动 —— 之前正是这个原因。
  var activePointers = Object.create(null);
  var pointerCount = 0;

  function pointerDistance() {
    var list = Object.keys(activePointers).map(function (k) { return activePointers[k]; });
    if (list.length < 2) return 0;
    var dx = list[0].x - list[1].x;
    var dy = list[0].y - list[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function pointerMid() {
    var list = Object.keys(activePointers).map(function (k) { return activePointers[k]; });
    return {
      x: (list[0].x + list[1].x) / 2,
      y: (list[0].y + list[1].y) / 2,
    };
  }

  function beginPinch() {
    touchMode = true;
    endDrag();
    pinchStartDist = pointerDistance() || 1;
    pinchStartScale = scale;
  }
  function stopPinch() {
    touchMode = false;
    pinchStartDist = 0;
    dragging = false;
    modal.classList.remove('dragging');
  }

  modal.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target === closeBtn) return;
    activePointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    pointerCount++;
    e.preventDefault();

    if (pointerCount >= 2) {
      // 第二根手指落下 -> 进入捏合;即使只有一帧也要立即算一次,
      // 避免"两指按下去但没移动"时看起来完全没反应
      beginPinch();
      return;
    }
    dragging = true;
    dragX = e.clientX;
    dragY = e.clientY;
    dragPosX = posX;
    dragPosY = posY;
    modal.classList.add('dragging');
    try { modal.setPointerCapture(e.pointerId); } catch (err) {}
  });

  modal.addEventListener('pointermove', function (e) {
    var p = activePointers[e.pointerId];
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    e.preventDefault();

    if (touchMode) {
      var dist = pointerDistance();
      if (dist && pinchStartDist) {
        // 围绕两指中点缩放:该点对应的图片内容保持不动
        zoomAt(pointerMid().x, pointerMid().y, pinchStartScale * (dist / pinchStartDist));
      }
      return;
    }
    if (!dragging) return;
    posX = dragPosX + (e.clientX - dragX);
    posY = dragPosY + (e.clientY - dragY);
    updateTransform();
  });

  function releasePointer(e) {
    if (!activePointers[e.pointerId]) return;
    delete activePointers[e.pointerId];
    pointerCount = Math.max(0, pointerCount - 1);
    try { if (modal.releasePointerCapture) modal.releasePointerCapture(e.pointerId); } catch (err) {}
    if (pointerCount >= 2) return;        // 还够两指,继续捏合
    if (pointerCount === 1) {
      // 从捏合退化成单指:重新以剩下这根手指为起点拖动,避免跳变
      stopPinch();
      var ids = Object.keys(activePointers);
      var p = activePointers[ids[0]];
      dragging = true;
      dragX = p.x;
      dragY = p.y;
      dragPosX = posX;
      dragPosY = posY;
      modal.classList.add('dragging');
      return;
    }
    stopPinch();
  }

  modal.addEventListener('pointerup', releasePointer);
  modal.addEventListener('pointercancel', releasePointer);
})();
  </script>
  <script>
var _hmt = _hmt || [];
(function() {
  var hm = document.createElement("script");
  hm.src = "https://hm.baidu.com/hm.js?d69e07b9eec7a81616400c95de2448f4";
  var s = document.getElementsByTagName("script")[0];
  s.parentNode.insertBefore(hm, s);
})();
  </script>
</body>
</html>`;
}

// ---------------- 视频页 ----------------
function videoHtml() {
  return `<!DOCTYPE html>
<!-- ${BUILD} | 视频页 -->
<html lang="zh-CN">
<head>
    <meta charSet="utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1" />
    <meta http-equiv="Cache-Control" content="no-transform" />
    <meta http-equiv="Cache-Control" content="no-siteapp" />
    <meta name="referrer" content="never">
    <meta name="renderer" content="webkit" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>小姐姐视频在线随机播放 - 魏无羡</title>
    <style>
      ${css()}
      /* ---------- 视频页专属样式 ---------- */
      /* 提示条只在真出错时出现,平时完全不显示,不干扰画面 */
      #hint {
        position: fixed;
        left: 50%;
        bottom: 76px;
        transform: translateX(-50%);
        max-width: 90vw;
        padding: 6px 14px;
        border-radius: 16px;
        background: rgba(0,0,0,.6);
        color: #fff;
        font-size: 14px;
        line-height: 1.4;
        text-align: center;
        pointer-events: none;
        opacity: 0;
        transition: opacity .2s;
      }
      #hint.show { opacity: 1; }
    </style>
</head>
<body>
  <section id="main">
    <video id="player" src="${MEDIA_BASE}/video" preload="auto" controls autoplay webkit-playsinline playsinline x5-playsinline></video>
  </section>
  <section id="buttons">
    <button id="switch" type="button">连续: 开</button>
    <button id="next" type="button">播放下一个</button>
    <a href="/?type=png"><button id="qh" type="button">切换图片</button></a>
  </section>
  <div id="hint"></div>

  <script>
// 视频页:核心是"换视频必须是一个全新的 URL + 显式 load()"
//
// 之前是 player.src = 固定URL; player.play():
//   - 同一个 URL 赋值给 src 属于同一次资源加载,浏览器不会重新请求,
//     所以"播放下一个"点了没反应、切换页面回来也一样;
//   - 固定 URL 还容易被浏览器/中间层缓存,拿到上一次的视频。
// 现在:每次都是 新URL(?r=随机) -> setAttribute('src') -> load() -> play()
//   load() 会中止上一段请求并重新做资源选择,这才是"刷新"的关键。
(function () {
  var MEDIA_VIDEO = '${MEDIA_BASE}/video';   // 媒体地址(相对同域)
  var player = document.getElementById('player');
  var hintEl = document.getElementById('hint');
  var nextBtn = document.getElementById('next');
  var switchBtn = document.getElementById('switch');

  var auto = true;
  var seq = 0;          // 重试防串台:回调里的 seq 与当前不一致就丢弃
  var loadTimer = null; // 卡死看门狗
  var retryTimer = null;
  var retry = 0;
  var hintTimer = null;
  var loading = false;  // 是否正在加载(没加载过就不该弹错误提示)
  var metaTimer = null; // 元数据看门狗:避免停留在 300x150 的默认"长条"盒子上
  var MAX_RETRY = 5;
  var WATCHDOG_MS = 25000;
  var META_MS = 12000;

  function showHint(text, autoHideMs) {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    if (!text) { hintEl.classList.remove('show'); return; }
    hintEl.textContent = text;
    hintEl.classList.add('show');
    if (autoHideMs) {
      hintTimer = setTimeout(function () { hintEl.classList.remove('show'); }, autoHideMs);
    }
  }

  function clearTimers() {
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (metaTimer) { clearTimeout(metaTimer); metaTimer = null; }
  }

  // 随机参数:强制浏览器发一次全新请求(去重靠 Worker 写的 Cookie)
  function nextVideoUrl() {
    return MEDIA_VIDEO + '?r=' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
  }

  function safePlay() {
    try {
      var p = player.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) { /* 自动播放被拦截等,忽略 */ }
  }

  // 播放下一个 / 连播 / 重试 都走这里
  function loadVideo() {
    var my = ++seq;
    clearTimers();
    loading = true;

    try { player.pause(); } catch (e) {}

    player.setAttribute('src', nextVideoUrl());
    player.load();      // 关键:中止旧请求 + 重新做资源选择
    safePlay();

    // 元数据看门狗:videoWidth 还是 0 说明分辨率未知,
    // 元素会保持 300x150 的默认比例(刷新时看到的"长条"),重来一次
    metaTimer = setTimeout(function () {
      if (my !== seq) return;
      if (!player.videoWidth && player.readyState === 0 && !player.error) loadVideo();
    }, META_MS);

    // 看门狗:一直读不到数据就重来一次(服务端偶发 502/空响应)
    loadTimer = setTimeout(function () {
      if (my !== seq) return;
      if (player.readyState < 2 && !player.error) loadVideo();
    }, WATCHDOG_MS);
  }

  function onReady() {
    clearTimers();
    retry = 0;
    loading = false;
    showHint('');
    safePlay();
  }

  // 失败:静默自动重试(不弹"加载中/重试中",保持画面干净),超过上限才提示
  function onError() {
    if (!loading) return;
    if (retry >= MAX_RETRY) {
      showHint('加载失败,请再点一次「播放下一个」');
      return;
    }
    retry++;
    if (retryTimer) return;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      loadVideo();
    }, 1500);
  }

  nextBtn.addEventListener('click', loadVideo);

  switchBtn.addEventListener('click', function () {
    auto = !auto;
    switchBtn.innerText = '连续: ' + (auto ? '开' : '关');
  });

  player.addEventListener('loadeddata', onReady);
  player.addEventListener('canplay', onReady);
  player.addEventListener('error', onError);
  player.addEventListener('stalled', function () {
    // 卡住不动超过一个看门狗周期就重来
    if (loadTimer) return;
    var my = seq;
    loadTimer = setTimeout(function () {
      loadTimer = null;
      if (my !== seq) return;
      if (player.readyState < 2 && !player.error && !player.paused) loadVideo();
    }, WATCHDOG_MS);
  });

  player.addEventListener('ended', function () {
    clearTimers();
    if (auto) {
      loadVideo();   // 连播同样走 load() 路径,避免"下一个不刷新"
    } else {
      showHint('本视频播放完毕');
      nextBtn.innerText = '播放下一个';
    }
  });

  // 切回本页面(从图片页返回 / 从后台切回)时,若视频停在结尾就自动换下一个
  window.addEventListener('pageshow', function (e) {
    if (player.ended) {
      if (auto) loadVideo();
    } else if (e.persisted) {
      safePlay();
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && player.ended && auto) loadVideo();
  });

  // 双击画面 = 换一个视频
  player.addEventListener('dblclick', loadVideo);

  // 地址栏只保留主域名:如果是从旧链接 /?type=video 进来的,静默清理掉后缀,
  // 不发新请求、不加历史记录,避免下次复制地址又带回 ?type=video
  if (location.search) {
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
  }

  // 首屏:脚本就绪后再发起,避免和页面其他请求抢带宽
  loadVideo();
})();
  </script>
  <script>
var _hmt = _hmt || [];
(function() {
  var hm = document.createElement("script");
  hm.src = "https://hm.baidu.com/hm.js?d69e07b9eec7a81616400c95de2448f4";
  var s = document.getElementsByTagName("script")[0];
  s.parentNode.insertBefore(hm, s);
})();
  </script>
</body>
</html>`;
}

// 两个页面共用的基础样式
function css() {
  return `* {
    border: 0;
    margin: 0;
    padding: 0;
    outline: none;
    box-sizing: border-box;
  }
  body {
    background: #000;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  #main {
    width: 100%;
    height: calc(100vh - 60px);
    display: flex;
    justify-content: center;
    align-items: center;
    background: #000;
    overflow: hidden;
  }
  /* 关键:用 max-width/max-height 限制,而不是 width:100%。
     width:100% 会把 <video> 元素本身撑到整屏宽(=1.73:1 的长条),
     而竖屏视频(如 576x1134)只在里面画中间一小条,剩下的都是黑边,
     原生控件条跟着元素宽度铺满整屏 —— 看起来就是"进度条跑到视频外面"。
     改用 max-width/max-height + width/height:auto,元素盒子会收缩到画面本身大小。 */
  #player {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
  }
  #buttons {
    height: 60px;
    padding: 10px;
    display: flex;
    align-items: center;
  }
  #switch,
  #next,
  #qh {
    background: #FFC0CB;
    color: #000000;
    font-size: 16px;
    font-weight: bold;
    height: 40px;
    padding: 0px 20px;
    margin: 0px 5px;
    border-radius: 20px;
    cursor: pointer;
  }`;
}
