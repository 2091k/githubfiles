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
    </style>
</head>
<body>
  <section id="main">
    <img id="player" src="随机图片地址">
  </section>
  <section id="buttons">
    <a href="?type=video">
      <button id="qh">切换视频</button>
    </a>
    <button id="next" onclick="location.reload()">下一个</button>
  </section>
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
    <video id="player" src="随机视频地址" controls autoplay webkit-playsinline playsinline></video> 
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
        player.src = 'https://xjjvideo.oo.me.eu.org';
        player.play();
      });
      document.getElementById('switch').addEventListener('click', function () {
        auto = !auto;
        this.innerText = '连续: ' + (auto ? '开' : '关');
      });
      player.addEventListener('ended', function () {
        if (auto) {
          player.src = '随机视频地址';
          player.play();
        }
      });
    })(window, document);
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
