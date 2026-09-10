/* ══════════════════════════════════════════════
   config.js —— 上线时用的默认设置
   ──────────────────────────────────────────────
   注意：这个文件会被原样送到每一个访客的浏览器里。
   写在这里的密钥，任何人都能在网页源码里看到。
   所以：

     · 只放一把「公用钥匙」，别放你的主密钥；
     · 去 DeepSeek 后台给它单独设一个月度额度上限；
     · 额度用完了，把 apiKey 改回空字符串，重新发布即可。

   apiKey 留空时，网站不会替访客连接，
   每个人需要自己在「器皿」里填自己的密钥。
   ══════════════════════════════════════════════ */

export const DEPLOY = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',

  /* 访客第一次打开时，是否把上面那把钥匙直接写进他的浏览器 */
  autoConnect: true,
};

/** 这个站点是否自带了一把公用钥匙 */
export function hasDeployKey() {
  return typeof DEPLOY.apiKey === 'string' && DEPLOY.apiKey.trim().length > 8;
}
