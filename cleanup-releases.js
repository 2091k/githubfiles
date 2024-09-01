const axios = require('axios');

const FILES_TOKEN = process.env.FILES_TOKEN;  // GitHub Token
const REPO_OWNER = '2091k';  // GitHub用户名
const REPO_NAME = 'githubfiles';  // 仓库名称
const RELEASE_ID = 172925004;  // Release ID

const deleteOldFiles = async () => {
  const now = new Date();
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);  // 计算3小时前的时间

  try {
    // 获取指定Release的详细信息
    const releaseDetails = await axios.get(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/${RELEASE_ID}`, {
      headers: {
        Authorization: `token ${FILES_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    for (const asset of releaseDetails.data.assets) {
      const uploadTime = new Date(asset.created_at);
      if (uploadTime < threeHoursAgo) {
        // 删除超过3小时的文件
        await axios.delete(asset.url, {
          headers: {
            Authorization: `token ${FILES_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        console.log(`Deleted ${asset.name} from Release ID: ${RELEASE_ID}`);
      }
    }
  } catch (error) {
    console.error('Error deleting old files:', error.message);
  }
};

deleteOldFiles();
