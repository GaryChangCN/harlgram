# Harlgram 黑白轻拟物图标

2026-10-29，内置 imagegen 编辑第三轮 D3。按用户要求改为黑白/中性灰、下方横条直角矩形，增加克制的浅浮雕与折纸明暗。随后用户确认该版本，已接入应用资源并完成真机桌面及点击启动验证；接入记录见 `docs/APP_ICON.md`。

参考方向来自官方的轻拟物设计理念与 HarmonyOS 7 沉浸光感介绍；没有声称是系统默认图标或精确复刻默认图标。

- https://developer.huawei.com/consumer/cn/design/concept/
- https://consumer.huawei.com/cn/harmonyos-7/

输入图：先前未采用的蓝色设计稿；不随源码分发。

定稿：`AppScope/resources/base/media/harlgram_icon.png`。

## 完整提示词

```text
Use case: precise-object-edit / logo-brand.
Edit the supplied Harlgram launcher icon. Keep the existing overall composition: a circular O containing a very simple Telegram-like paper airplane pointing northeast, with a detached horizontal bar centered below. Preserve the airplane's simplified silhouette and its single main fold cut. Do not add the old complicated H crossbar back.

REQUIRED CHANGES:
1. Strictly monochrome black, white and neutral grey only. Remove ALL blue, violet, cyan and colored tint. The full square background is deep graphite black; the circle, plane and underline are luminous neutral white.
2. Replace the rounded capsule underline with a plain horizontal RECTANGLE. Both ends are straight vertical edges. All four corners are exact sharp 90-degree corners, absolutely zero corner radius. Keep its current width, height and centered alignment.
3. Introduce just a restrained touch of skeuomorphism, inspired by contemporary HarmonyOS 7 native launcher icon light/material treatment: white shapes with very shallow satin-ceramic relief, a fine soft upper-left highlight, tiny neutral-grey side facets, and subtle close contact shadows. The main white faces stay bright and clean. The airplane may have a very gentle single folded-paper plane change in value, but no added geometry or internal detail. Ring is softly beveled in depth only, maintaining a perfect circular silhouette. The bar has shallow thickness but its FRONT SILHOUETTE remains a mathematically sharp-cornered rectangle. The background has only a barely perceptible black-to-charcoal lighting falloff, no texture or scene.

This must read as a polished actual mobile APP ICON, not an engraved metal plaque, product photograph, medallion, or logo on a presentation sheet. Front-on orthographic view. Keep the entire background full-bleed to all canvas edges and leave the outer square unmasked for the OS launcher. Maintain generous spacing and clear silhouette at small sizes. Subtle materiality, not bulky 3D. No glossy glass, no chrome, no neon, no orbit effects, no outer frame, no round-ended underline, no extra symbols, no text, no mockup. Deliver one square finished icon.
```
