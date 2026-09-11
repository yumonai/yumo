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

     当前顺序：智谱 glm-4-flash-250414（主力，免费且稳定）
             → 硅基流动 → 讯飞星火。
     哪一条的 apiKey 是空的，就跳过哪一条。
     想让某个模型当主力，把它排到前面就行。

     model 为空或 apiKey 为空的通道会被忽略，所以
     没配好的那几条放着不动也不会出问题。         */
  PROVIDERS: [
    /* 智谱 glm-4-flash-250414 —— 当前主力。官方定价页标注输入/输出全免费。
       ⚠️ 2026-09-12 用户实测：GLM-4.7-Flash（虽然也是免费、官方还推荐用于
          「情感/角色扮演」）在这一产品上的实际效果**不如这一条**——它更爱下判断、
          更爱把话拉长，而且免费池拥堵（连打 10 次 7 次被 429/1305 挡回）。
          所以按用户判断退回这一条，glm-4.7-flash 不再挂载。
       实测：1~3 秒/轮，从不被限流。 */
    {
      name: 'glm',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash-250414',      // 128K 上下文
      apiKey: 'fd099e2484994651b61248755f20c14a.AM12qfemxfgCKDwQ',
      noThink: true,                    // 思考型模型会返回空正文，必须显式关掉
      maxTokens: 1024,                  // ⚠️ 智谱视觉模型只收 1~1024，超出直接 1210 报错
    },

    /* 火山引擎豆包 —— 每天 200 万 tokens 自动刷新，单日额度最大
       注意：model 要填控制台里的「接入点 ID」，形如 ep-2026xxxx */
    {
      name: 'volc',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: '',                        // ← 填接入点 ID
      apiKey: '',                       // ← 填这里
    },

    /* 硅基流动 —— 第二跳，另一家供应商，智谱排队或限流时它能顶上

       状态（2026-09-10）：账号已实名 + 已充值。
         实测 THUDM/GLM-4-9B-0414 首字 369ms，且不计费（免费档）。
         此前「30001 余额不足」的问题，在充值／领取「16 元认证奖励券」
         之后即消失 —— 结论不变：免费模型并不豁免余额检查，
         余额为 0 时连官方标注「永久免费」的模型也会被挡。

       模型可用性（2026-09 实测）：
         THUDM/GLM-4-9B-0414            ← 当前选用：非思考型，不会吐空正文
         Qwen/Qwen3-8B                  官方明确标注永久免费，可作备选
                                          （若改用它且回复为空，说明开了思考模式）
         Qwen/Qwen2.5-7B-Instruct       可作备选
         deepseek-ai/DeepSeek-R1-Distill-Qwen-7B  → 30003 已停用，别用
         THUDM/glm-4-flash                        → 20012 不存在，别用
       报错码对照：30001 余额不足 / 30003 模型停用 / 20012 模型不存在。
       注意：Qwen 的 3.5/3.6 系列看着像小模型，实际是收费的。 */
    {
      name: 'siliconflow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'THUDM/GLM-4-9B-0414',
      apiKey: 'sk-kxrzpfwazsndxewucvrpmkecmgywpzzzhsbrenttqcostpcq',
    },

    /* 讯飞星火 X2.5 —— 第三跳兜底（走讯飞星辰 MaaS 平台）。
       2026-09-11 实测：spark-x2.5-4b 可用，限时 0 元/百万 tokens；
       1.7B 也通（spark-x2.5-1.7b），但 4B 能力更强、同免费，故选 4B。
       ⚠️ 这是一款思考型模型：不关思考时 token 会被推理吃掉、正文为空
       （和当年 GLM 思考模型同一个坑），所以 extra 里带 reasoning.effort=none。
       实测语感：共情到位、零空安慰，略带角色扮演小动作；作为兜底合格。 */
    {
      name: 'spark',
      baseUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/v2',
      model: 'spark-x2.5-4b',
      apiKey: 'ak-1aca17f179c214ba207af9d9c6098332',
      maxTokens: 1024,
      extra: { reasoning: { effort: 'none' } },
    },

    /* 第三跳（旧）：DeepSeek —— 已于 2026-09-10 按你的要求完全撤下。
       （原主钥匙 sk-53c908… 已作废，如仍在使用请去后台删除。） */
  ],

  /* ── 账户云端同步（Supabase）────────────────
     publishableKey 是「可以公开」的钥匙——它本来就设计成
     放进网页里；真正的防线是数据库的行级安全（RLS）：
     每个用户只能读写自己的那一行。
     ⚠️ 千万不要把 sb_secret_ 开头的那把放进来。 */
  supabase: {
    url: 'https://pkotlnttjilqfyaiwram.supabase.co',
    publishableKey: 'sb_publishable_AgqKqpuCnIvV-enumiSBeQ_iB8uhGpi',
  },

  /* 访客第一次打开时，是否替他接上（钥匙留在配置文件里，不进他的浏览器） */
  autoConnect: true,
};

/** 是否至少配好了一条通道 */
export function hasDeployKey() {
  return (DEPLOY.PROVIDERS || []).some(
    (p) => typeof p.apiKey === 'string' && p.apiKey.trim().length > 8 && String(p.model || '').trim(),
  );
}
