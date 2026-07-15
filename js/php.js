addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');

  if (type === "png") {
    return new Response(imageHtml(), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  } else {
    return new Response(videoHtml(), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
}

function imageHtml() {
  return `<!DOCTYPE html>
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
      /* 图片弹窗缩放样式 */
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
      }
      #imgModal.active {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #imgModal.dragging {
        cursor: grabbing;
      }
      #modalImg {
        max-width: 95vw;
        max-height: 95vh;
        transition: transform 0.1s ease-out;
        transform-origin: center center;
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
    <img id="player" src="https://xjjtu.2091k.cn">
  </section>
  <section id="buttons">
    <a href="?type=video">
      <button id="qh">切换视频</button>
    </a>
    <button id="next" onclick="location.reload()">下一个</button>
  </section>

  <!-- 图片放大弹窗 -->
  <div id="imgModal">
    <button id="closeModal">×</button>
    <img id="modalImg" src="">
  </div>

  <script>
var _hmt = _hmt || [];
(function() {
  var hm = document.createElement("script");
  hm.src = "https://hm.baidu.com/hm.js?d69e07b9eec7a81616400c95de2448f4";
  var s = document.getElementsByTagName("script")[0]; 
  s.parentNode.insertBefore(hm, s);
})();

// 图片缩放逻辑
(function(){
  const player = document.getElementById('player');
  const modal = document.getElementById('imgModal');
  const modalImg = document.getElementById('modalImg');
  const closeBtn = document.getElementById('closeModal');

  let scale = 1;
  let posX = 0;
  let posY = 0;
  let isDrag = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let imgStartX = 0;
  let imgStartY = 0;
  const zoomStep = 0.15;
  const maxScale = 5;
  const minScale = 0.3;

  // 打开弹窗
  player.addEventListener('click', ()=>{
    modalImg.src = player.src;
    scale = 1;
    posX = 0;
    posY = 0;
    updateTransform();
    modal.classList.add('active');
  })

  // 关闭弹窗
  closeBtn.addEventListener('click', ()=> modal.classList.remove('active'));
  modal.addEventListener('click', (e)=>{
    if(e.target === modal) modal.classList.remove('active');
  })

  // 更新图片位移缩放
  function updateTransform(){
    modalImg.style.transform = \`translate(\${posX}px,\${posY}px) scale(\${scale})\`;
  }

  // 滚轮缩放
  modal.addEventListener('wheel', (e)=>{
    e.preventDefault();
    if(e.deltaY < 0){
      scale += zoomStep;
    }else{
      scale -= zoomStep;
    }
    scale = Math.max(minScale, Math.min(maxScale, scale));
    updateTransform();
  }, {passive:false})

  // 拖拽逻辑
  modal.addEventListener('mousedown', (e)=>{
    isDrag = true;
    modal.classList.add('dragging');
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    imgStartX = posX;
    imgStartY = posY;
  })
  window.addEventListener('mousemove', (e)=>{
    if(!isDrag) return;
    posX = imgStartX + (e.clientX - dragStartX);
    posY = imgStartY + (e.clientY - dragStartY);
    updateTransform();
  })
  window.addEventListener('mouseup', ()=>{
    isDrag = false;
    modal.classList.remove('dragging');
  })
})();
  </script>
</body>
</html>`;
}

function videoHtml() {
  return `<!DOCTYPE html>
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
    </style>
</head>
<body>
  <section id="main">
    <video id="player" src="https://xjjvideo.2091k.cn" controls autoplay webkit-playsinline playsinline></video> 
  </section>
  <section id="buttons">
    <button id="switch">连续: 开</button>
    <button id="next">播放下一个</button>
    <a href="?type=png">
      <button id="qh">切换图片</button>
    </a>
  </section>
  <script>
    (function (window, document) {
      var auto = true;
      var player = document.getElementById('player');
      document.getElementById('next').addEventListener('click', function () {
        player.src = 'https://xjjvideo.2091k.cn';
        player.play();
      });
      document.getElementById('switch').addEventListener('click', function () {
        auto = !auto;
        this.innerText = '连续: ' + (auto ? '开' : '关');
      });
      player.addEventListener('ended', function () {
        if (auto) {
          player.src = 'https://xjjvideo.2091k.cn';
          player.play();
        }
      });
    })(window, document);
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
    height: calc(100vh - 60px);
    display: flex;
    justify-content: center;
    align-items: center;
  }
  #player {
    width: 100%;
    height: auto;
    max-height: 100%;
    cursor: zoom-in;
  }
  #buttons {
    height: 60px;
    padding: 10px;
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
  }`;
}
