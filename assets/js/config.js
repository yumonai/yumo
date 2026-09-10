/* ══════════════════════════════════════════════
   config.js —— 上线时用的默认设置
   ──────────────────────────────────────────────
   这个文件会被原样送到每一个访客的浏览器里。
   写在这里的钥匙，任何人都能在网页源码里看到。

   所以请务必：

     · 只放一把「公用钥匙」，不要放你的主钥匙；
     · 去上游后台给它单独设一个月度额度上限；
     · 额度用完时，把 apiKey 改回空字符串再发布，
       网站会自动退回「访客自填钥匙」的模式。

   界面上不会出现这里的任何字样——
   对访客来说，回话的就是 Yumo 本身。
   ══════════════════════════════════════════════ */

export const DEPLOY = {
  /* ── 通道清单 ───────────────────────────────
     按顺序尝试：前一条不通（钥匙过期 / 额度用光 / 限流 /
     网络不通），就自动换下一条，访客察觉不到。

     哪一条的 apiKey 是空的，就跳过哪一条。
     想让某个模型当主力，把它排到前面就行。

     model 为空或 apiKey 为空的通道会被忽略，所以
     没配好的那几条放着不动也不会出问题。         */
  PROVIDERS: [
    /* 智谱 GLM —— 官方文档明确永久免费，中文最好，免绑卡
       注册后把 key 填进来，就会自动成为主力 */
    {
      name: 'glm',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4.7-flash',           // 200K 上下文，免费
      visionModel: 'glm-4.6v-flash',    // 带了图就自动换成这个，免费
      apiKey: '',                       // ← 填这里
      vision: true,
    },

    /* 火山引擎豆包 —— 每天 200 万 tokens 自动刷新，单日额度最大
       注意：model 要填控制台里的「接入点 ID」，形如 ep-2026xxxx */
    {
      name: 'volc',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: '',                        // ← 填接入点 ID
      apiKey: '',                       // ← 填这里
      vision: true,
    },

    /* 硅基流动 —— 9B 以下模型永久免费，国内直连
       model 请照控制台「免费模型」列表里的全名填 */
    {
      name: 'siliconflow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen3-8B',
      apiKey: '',                       // ← 填这里
      vision: false,                    // 这条看图要另外挑视觉模型
    },

    /* DeepSeek —— 收费，但便宜且稳，留着兜底 */
    {
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      apiKey: 'sk-53c908b5a5c140f4893156c1f602367e',
      vision: true,
    },
  ],

  /* 访客第一次打开时，是否替他接上（钥匙留在配置文件里，不进他的浏览器） */
  autoConnect: true,
};

/** 是否至少配好了一条通道 */
export function hasDeployKey() {
  return (DEPLOY.PROVIDERS || []).some(
    (p) => typeof p.apiKey === 'string' && p.apiKey.trim().length > 8 && String(p.model || '').trim(),
  );
}
