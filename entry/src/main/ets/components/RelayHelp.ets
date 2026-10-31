/** Configuration help uses native grouped lists; no connection or persistence actions. */
@Component
export struct RelayHelp {
  @State private expanded: string = '';

  @Builder
  private section(title: string) {
    Text(title).fontSize(14).fontWeight(FontWeight.Medium)
      .fontColor($r('sys.color.ohos_id_color_text_secondary')).width('100%')
      .padding({ left: 16, top: 12, bottom: 4 })
  }
  @Builder
  private step(number: string, title: string, detail: string) {
    Row({ space: 16 }) {
      Text(number).fontSize(18).fontWeight(FontWeight.Medium)
        .fontColor($r('sys.color.ohos_id_color_emphasize')).width(24).align(Alignment.Top)
      Column({ space: 4 }) {
        Text(title).fontSize(16).fontColor($r('sys.color.ohos_id_color_text_primary')).width('100%')
        Text(detail).fontSize(14).fontColor($r('sys.color.ohos_id_color_text_secondary')).lineHeight(21).width('100%')
      }.layoutWeight(1)
    }.width('100%').alignItems(VerticalAlign.Top).padding(16)
  }
  @Builder
  private field(title: string, example: string, detail: string) {
    Column({ space: 5 }) {
      Row({ space: 12 }) {
        Text(title).fontSize(16).fontColor($r('sys.color.ohos_id_color_text_primary')).layoutWeight(1)
        Text(example).fontSize(14).fontColor($r('sys.color.ohos_id_color_text_secondary')).maxLines(2)
          .constraintSize({ maxWidth: '65%' }).textAlign(TextAlign.End)
      }.width('100%')
      Text(detail).fontSize(13).fontColor($r('sys.color.ohos_id_color_text_secondary')).lineHeight(20).width('100%')
    }.width('100%').padding(16)
  }
  @Builder
  private detail(id: string, title: string, body: string) {
    Column() {
      Row({ space: 12 }) {
        Text(title).fontSize(16).fontColor($r('sys.color.ohos_id_color_text_primary')).layoutWeight(1)
        SymbolGlyph(this.expanded === id ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
          .fontSize(14).fontColor([$r('sys.color.ohos_id_color_text_secondary')])
      }.width('100%').constraintSize({ minHeight: 56 }).padding({ left: 16, right: 16 })
        .onClick(() => { this.expanded = this.expanded === id ? '' : id; })
        .accessibilityText(title + (this.expanded === id ? '，收起' : '，展开')).accessibilityGroup(true)
      if (this.expanded === id) {
        Text(body).fontSize(14).fontColor($r('sys.color.ohos_id_color_text_secondary')).lineHeight(22).width('100%')
          .padding({ left: 16, right: 16, bottom: 16 })
      }
    }.width('100%')
  }
  build() {
    List({ space: 8 }) {
      ListItem() {
        Column({ space: 10 }) {
          Text('中转代理').fontSize(24).fontWeight(FontWeight.Bold)
            .fontColor($r('sys.color.ohos_id_color_text_primary')).width('100%')
          Text('通过加密的 WebSocket 隧道连接 Telegram，转发本应用的聊天、图片和视频。')
            .fontSize(14).fontColor($r('sys.color.ohos_id_color_text_secondary')).lineHeight(22).width('100%')
          Row({ space: 8 }) {
            Text('本应用').fontSize(13).fontColor($r('sys.color.ohos_id_color_text_secondary'))
            SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(10).fontColor([$r('sys.color.ohos_id_color_text_secondary')])
            Text('中转服务').fontSize(13).fontColor($r('sys.color.ohos_id_color_text_secondary'))
            SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(10).fontColor([$r('sys.color.ohos_id_color_text_secondary')])
            Text('Telegram').fontSize(13).fontColor($r('sys.color.ohos_id_color_text_secondary'))
          }.padding({ top: 4 })
        }.width('100%').padding({ left: 16, right: 16, top: 16, bottom: 8 })
      }
      ListItem() { this.section('开始使用') }
      ListItemGroup({ style: ListItemGroupStyle.CARD }) {
        ListItem() {
          this.step('1', '获取中转信息', '获取兼容服务的域名、访问令牌和请求头。')
        }
        ListItem() {
          this.step('2', '填写并测试', '填写配置并测试，测试不会保存或切换线路。')
        }
        ListItem() {
          this.step('3', '保存后启用', '保存后点「使用此配置」，同时仅启用一条线路。')
        }
      }.divider({ strokeWidth: 0.5, startMargin: 56, endMargin: 16, color: $r('sys.color.ohos_id_color_list_separator') }).margin({ left: 0, right: 0 })
      ListItem() { this.section('填写信息') }
      ListItemGroup({ style: ListItemGroupStyle.CARD }) {
        ListItem() { this.field('名称', '我的中转', '自定义一个便于识别的名字。') }
        ListItem() { this.field('中转域名', 'relay.example.com', '可带 https://，不要附加路径、参数或令牌。') }
        ListItem() { this.field('访问令牌', '服务提供者给你的令牌', '填写 32～256 个字符的原始令牌，不要加 Bearer。') }
        ListItem() { this.field('令牌请求头', 'Authorization', '通常保留默认值；服务提供者指定其他字段时再修改。') }
      }.divider({ strokeWidth: 0.5, startMargin: 16, endMargin: 16, color: $r('sys.color.ohos_id_color_list_separator') }).margin({ left: 0, right: 0 })
      ListItem() { this.section('更多说明') }
      ListItemGroup({ style: ListItemGroupStyle.CARD }) {
        ListItem() {
          this.detail('header', '请求头示例', '默认发送 Authorization: Bearer <访问令牌>。\n如果服务指定 X-Relay-Token，则填写该字段名，应用直接发送原始令牌，不添加 Bearer。客户端与服务端必须一致。')
        }
        ListItem() {
          this.detail('deploy', '自行部署', '服务需要兼容 harlgram-tunnel-v1，具备有效 HTTPS 证书、WebSocket 双向传输、Telegram TCP 转发和独立令牌验证。\n只配置 DNS 或普通网页反代还不够，部署后请用「测试连接」确认。SOCKS5 和 MTProxy 地址不能直接填入。')
        }
        ListItem() {
          this.detail('scope', '连接与使用范围', '只影响本应用，不设置系统 VPN 或其他应用代理，不支持 UDP 通话。\n中转中断不会自动改为直连；选择「直接连接」会停用中转并保留配置。切换前验证失败会保留原选择，当前项可点「重新连接」。')
        }
      }.divider({ strokeWidth: 0.5, startMargin: 16, endMargin: 16, color: $r('sys.color.ohos_id_color_list_separator') }).margin({ left: 0, right: 0 })
      ListItem() {
        Text('请使用自己或信任的中转服务。访问令牌不是 Telegram 验证码、登录密码或机器人令牌。')
          .fontSize(12).fontColor($r('sys.color.ohos_id_color_text_secondary')).lineHeight(19).width('100%').padding(16)
      }
    }.width('100%').constraintSize({ maxWidth: 520 }).height('100%').padding({ left: 16, right: 16, bottom: 24 })
      .contentStartOffset(56).scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring)
  }
}
