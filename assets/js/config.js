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
    /* 智谱 GLM —— 当前主力。官方文档明确标注免费，中文最好，免绑卡。
       ⚠️ 模型名是实测挑出来的，别随手改：
         · glm-4-flash-250414  不思考 → 1~3 秒，6/6 稳。**用的就是它**
         · glm-4.7-flash       是思考模型：会把 token 全烧在推理上、
                               正文返回空（finish_reason: length），
                               实测连打 6 次全被 1305「访问量过大」挡回
         · glm-4.6v-flash      免费视觉模型（免费档较拥堵，不通会自动跳过） */
    {
      name: 'glm',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash-250414',      // 128K 上下文
      visionModel: 'glm-4v-flash',      // 带了图自动换这个（实测 0.6 秒）
      apiKey: 'fd099e2484994651b61248755f20c14a.AM12qfemxfgCKDwQ',
      vision: true,
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
      vision: true,
    },

    /* 硅基流动 —— 免费的兜底，另一家供应商，智谱排队时它能顶上
       ⚠️ 现在这条「还不会生效」：实测该账号所有模型都返回
          30001 Sorry, your account balance is insufficient，
          连官方标注免费的 THUDM/GLM-4-9B-0414 也一样。
          原因：硅基流动的免费模型要求先完成「实名认证」，
          未实名时所有模型都按收费计，余额为 0 就一律拒。
          → 去 cloud.siliconflow.cn 做实名，做完这条会自动开始工作，代码不用改。

       实测的免费名单（2026-08 快照，会变）：
         THUDM/GLM-4-9B-0414     对话，非思考型 ← 用这个
         THUDM/GLM-Z1-9B-0414    是思考型，会慢且可能吐空正文
         PaddlePaddle/PaddleOCR-VL-1.5  OCR 专用，不适合聊天
         tencent/Hunyuan-MT-7B   翻译专用
       注意：Qwen 的 3.5/3.6 系列看着像小模型，实际是收费的。 */
    {
      name: 'siliconflow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'THUDM/GLM-4-9B-0414',
      apiKey: 'sk-kxrzpfwazsndxewucvrpmkecmgywpzzzhsbrenttqcostpcq',
      vision: false,                    // 免费名单里没有可用的对话视觉模型
    },

    /* DeepSeek —— 保命兜底。GLM 正常时它一次都不会被调用，不产生费用。
       免费档会周期性排队（实测 glm-4.7-flash 连打 6 次全败），
       真到那一步它是唯一还能让站点开口的东西。

       想彻底断开：把这一整段删掉即可。
       更好的做法是拿一把免费的硅基流动钥匙顶上，那样两跳都不花钱。 */
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
