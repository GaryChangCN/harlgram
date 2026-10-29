# 应用图标

2026-10-29，用户确认采用黑白轻拟物纸飞机图标，并已在真机查看后确认效果。

## 定稿与配置

- 确认稿：`AppScope/resources/base/media/harlgram_icon.png`；设计记录见 [BRANDING.md](BRANDING.md)。
- 应用资源：`AppScope/resources/base/media/harlgram_icon.png`，与确认稿的压缩像素数据一致，仅移除生成元数据，不重新绘制造型。
- `AppScope/app.json5` 的 app.icon、`entry/src/main/module.json5` 的 EntryAbility.icon 和 startWindowIcon 均引用 `$media:harlgram_icon`。
- 当前使用官方支持的单层 PNG 图标配置，系统负责桌面外轮廓裁切。保留黑底、白色圆环、简化纸飞机、直角横条和轻微浮雕；不要恢复旧蓝色图标或胶囊横条。
- 资源统一放在 AppScope，由构建合入 entry，避免两处同名图标内容不一致。配置依据见[官方应用图标说明](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/quick-start/layered-image.md)。

## 已验证

- `./scripts/build.sh`：SDK 26 构建成功，日志位于 ignored `artifacts/build-app-icon.log`。
- 检查 signed HAP：图标资源存在，应用、入口与启动图标引用均正确。构建工具将 1254 × 1254 原图处理为包内 512 × 512 图标，因此不以压缩后字节相等作为验收条件。
- 指定 HOP-AL00 / API 26 真机正常覆盖安装与启动成功，保持原登录状态。
- 真机桌面显示新的黑白图标，系统圆角裁切后圆环和横条完整；点击该图标可进入已登录应用。截图 `artifacts/screenshots/app-icon-launcher.png` 仅留本机忽略目录。
- 用户现场确认「已经 ok 了我看了」。本次为资源变更，未触发消息发送或修改账号数据，不涉及新的服务端功能验收。

未验证其他设备形态或商店视觉审核；未卸载应用、清空沙箱或运行同 bundle 的 ohosTest。
