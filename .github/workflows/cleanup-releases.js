const axios = require('axios');
const fs = require('fs');

const FILES_TOKEN = process.env.FILES_TOKEN;  // GitHub Token
const REPO_OWNER = '2091k';  // GitHub用户名
const REPO_NAME = 'githubfiles';  // 仓库名称
const RELEASE_ID = 172925004;  // Release ID

const deleteOldFiles = async () => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);  // 计算1小时前的时间

  try {
    // 获取指定Release的详细信息
    const releaseDetails = await axios.get(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/${RELEASE_ID}`, {
      headers: {
        Authorization: `token ${FILES_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    let success = false;

    for (const asset of releaseDetails.data.assets) {
      const uploadTime = new Date(asset.created_at);
      if (uploadTime < oneHourAgo) {
        // 删除超过1小时的文件
        await axios.delete(asset.url, {
          headers: {
            Authorization: `token ${FILES_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        console.log(`Deleted ${asset.name} from Release ID: ${RELEASE_ID}`);
        success = true;
      }
    }

    if (success) {
      fs.writeFileSync('true.txt', `Files older than 1 hour have been deleted successfully.`, 'utf8');
    } else {
      fs.writeFileSync('false.txt', `No files older than 1 hour were found or deleted.`, 'utf8');
    }
  } catch (error) {
    fs.writeFileSync('false.txt', `Error deleting files: ${error.message}`, 'utf8');
    console.error('Error deleting old files:', error.message);
  }
};

deleteOldFiles();
