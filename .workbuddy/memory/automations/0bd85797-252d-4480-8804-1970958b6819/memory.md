# Automation Memory — yumodeep.me HTTPS 收尾

## 执行历史

### 2026-09-11 01:08
- 检查 `curl https://yumodeep.me/` → 返回 000（exit 60），TLS 报错 `subjectAltName does not match host name yumodeep.me`。
- 443 端口现下发的是默认 `*.github.io` 通配证书，尚未换上自定义域名证书。
- `gh api repos/yumonai/yumonai.github.io/pages` → `{"cname":"yumodeep.me","https_enforced":false,"status":"built"}`。
- 结论：证书仍在签发中，未做任何设置修改。
- 待办：证书就绪后再 PUT `-f cname=yumodeep.me -F https_enforced=true`。

### 2026-09-11 07:44 — 已解决 ✅
- 07:42 复查仍 000（还在下发 `*.github.io` 通配证书），判定签发流程卡住。
- 修复：用户确认后执行域名重置——`PUT pages -f cname=""` 清空域名 → 重新 `PUT pages -f cname=yumodeep.me`，触发重新签发。
- 约 30 秒后证书签出（subject 变为 `CN=yumodeep.me`），`PUT ... -F https_enforced=true` 开启强制跳转。
- 验证：http→https 301 跳转 200；https 裸域和 www 均 200；API `https_enforced=true`。
- 经验：GitHub Pages 自定义域证书长时间未签发时，清空再重填 cname 是有效的重触发手段，且签发只需几十秒。
