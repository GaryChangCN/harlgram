import { HdsNavigation, HdsNavigationTitleMode } from '@kit.UIDesignKit';
import { SymbolGlyphModifier } from '@kit.ArkUI';
import { RelayHelp } from './RelayHelp';
import { common } from '@kit.AbilityKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { telegramService } from '../services/TelegramService';
import { RelayConfiguration, RelayProfile, RelayRegistry, relayRegistry, relayUpsert, relayRemove } from '../model/RelayModels';

@Component
export struct RelaySettings {
  @Prop dark: boolean = false;
  onClose: () => void = () => {};
  onSaved: () => void = () => {};
  onBusy: (busy: boolean) => void = () => {};
  onBackReady: (handler: () => void) => void = () => {};
  @State private registry: RelayRegistry = { version: 2, activeId: '', profiles: [] };
  @State private editing: boolean = false;
  @State private helpVisible: boolean = false;
  @State private profileId: string = '';
  @State private name: string = '';
  @State private domain: string = '';
  @State private token: string = '';
  @State private headerName: string = 'Authorization';
  @State private busy: boolean = true;
  @State private status: string = '';
  @State private error: boolean = false;
  private live: boolean = true;
  aboutToAppear(): void {
    this.onBackReady(() => this.back());
    this.live = true; this.onBusy(true);
    telegramService.loadRelayRegistry().then((value: RelayRegistry) => { if (this.live) this.registry = value; })
      .catch(() => { if (this.live) { this.error = true; this.status = '无法读取网络配置，请重试'; } })
      .finally(() => { if (this.live) { this.busy = false; this.onBusy(false); } });
  }
  aboutToDisappear(): void {
    this.live = false; this.token = ''; this.registry = { version: 2, activeId: '', profiles: [] };
    this.onBusy(false); this.onBackReady(() => {});
  }
  private back(): void {
    if (this.busy) return;
    if (this.helpVisible) { this.helpVisible = false; }
    else if (this.editing) { this.editing = false; this.token = ''; this.status = ''; } else this.onClose();
  }
  private edit(profile?: RelayProfile): void {
    if (this.busy) return;
    let id = '';
    if (!profile) cryptoFramework.createRandom().generateRandomSync(16).data.forEach((n: number) => { id += n.toString(16).padStart(2, '0'); });
    this.profileId = profile ? profile.id : id; this.name = profile ? profile.name : '';
    this.domain = profile ? profile.endpoint.replace(/^https:\/\//, '') : ''; this.token = profile ? profile.token : '';
    this.headerName = profile?.headerName || 'Authorization'; this.status = ''; this.error = false; this.editing = true;
  }
  private configuration(): RelayConfiguration {
    return { enabled: true, endpoint: this.domain, token: this.token, headerName: this.headerName };
  }
  private async persist(value: RelayRegistry, reconnect: boolean): Promise<void> {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    await telegramService.saveRelayRegistry(context, value, reconnect);
    if (this.live) this.registry = value;
  }
  private async operate(action: string, id: string = ''): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.onBusy(true); this.error = false;
    this.status = action === 'test' ? '正在验证 Telegram 连接…' : '正在保存配置…';
    try {
      if (action === 'test') {
        await telegramService.testRelayConfiguration(this.configuration());
        if (this.live) this.status = 'Telegram 连接验证通过';
      } else {
        let value = this.registry;
        if (action === 'save') value = relayUpsert(value, { id: this.profileId, name: this.name, endpoint: this.domain, token: this.token, headerName: this.headerName });
        if (action === 'select') value = relayRegistry({ version: 2, activeId: id, profiles: value.profiles });
        if (action === 'delete') value = relayRemove(value, id);
        await this.persist(value, action === 'select' && id === this.registry.activeId);
        if (this.live) { this.editing = false; this.token = ''; this.status = action === 'select' ? '连接方式已更新' : '配置已保存'; }
      }
    } catch (error) {
      if (action !== 'test') {
        try { const saved = await telegramService.loadRelayRegistry(); if (this.live) this.registry = saved; } catch (_) {}
      }
      if (this.live) { this.error = true; this.status = (error as Error).message || '操作未完成，请重试'; }
    }
    finally { if (this.live) { this.busy = false; this.onBusy(false); } }
  }
  private remove(): void {
    if (this.registry.activeId === this.profileId) { this.error = true; this.status = '请先选择其他连接方式，再删除当前配置'; return; }
    const id = this.profileId;
    this.getUIContext().getPromptAction().showDialog({ title: '删除代理配置', message: '仅删除此代理配置，不影响 Telegram 账号。',
      buttons: [{ text: '取消', color: '#718398' }, { text: '删除', color: '#D56464' }] })
      .then(result => { if (this.live && result.index === 1) this.operate('delete', id); }).catch(() => {});
  }
  private ink(): ResourceColor { return $r('sys.color.ohos_id_color_text_primary'); }
  private surface(): string { return this.dark ? '#1C2733' : '#FFFFFF'; }
  @Builder
  private route(profile: RelayProfile) {
    Column({ space: 10 }) {
      Row({ space: 12 }) {
        Column({ space: 4 }) {
          Text(profile.name).fontSize(16).fontColor(this.ink()).width('100%')
          Text(profile.endpoint.replace(/^https:\/\//, '')).fontSize(12).fontColor('#718398').width('100%').maxLines(2)
        }.layoutWeight(1)
        if (this.registry.activeId === profile.id) { Text('使用中').fontSize(13).fontColor('#268BDE') }
      }.width('100%')
      Row({ space: 12 }) {
        Button('编辑').buttonStyle(ButtonStyleMode.TEXTUAL).height(36).fontSize(13).enabled(!this.busy).onClick(() => this.edit(profile))
        Button(this.registry.activeId === profile.id ? '重新连接' : '使用此配置').buttonStyle(ButtonStyleMode.TEXTUAL).height(36).fontSize(13).enabled(!this.busy)
          .onClick(() => { this.operate('select', profile.id); })
      }.width('100%').justifyContent(FlexAlign.End)
    }.width('100%').padding(16).backgroundColor(this.surface()).borderRadius(14)
  }
  build() {
    HdsNavigation() {
      if (this.helpVisible) {
        RelayHelp()
      } else {
      Scroll() {
        Column({ space: 18 }) {
          if (!this.editing) {
            Row({ space: 12 }) {
              Text('直接连接').fontSize(16).fontColor(this.ink()).layoutWeight(1)
              if (!this.registry.activeId) { Text('使用中').fontSize(13).fontColor('#268BDE') }
              else { Button('使用').buttonStyle(ButtonStyleMode.TEXTUAL).height(36).fontSize(13).enabled(!this.busy).onClick(() => { this.operate('select'); }) }
            }.width('100%').padding(16).backgroundColor(this.surface()).borderRadius(14)
            ForEach(this.registry.profiles, (profile: RelayProfile) => { this.route(profile) }, (profile: RelayProfile) => profile.id)
            Button('添加代理配置').width('100%').height(46).enabled(!this.busy && this.registry.profiles.length < 32).onClick(() => this.edit())
            Text('仅影响本应用。使用代理时，连接失败不会自动改为直连。').fontSize(13).fontColor('#718398').width('100%').lineHeight(21)
          } else {
            Column({ space: 10 }) {
              Text('名称').fontSize(14).fontColor(this.ink()).width('100%')
              TextInput({ text: this.name, placeholder: '自建中转' }).maxLength(40).enabled(!this.busy).id('relay-name')
                .onChange((value: string) => { this.name = value; this.status = ''; }).accessibilityText('配置名称')
              Text('中转域名').fontSize(14).fontColor(this.ink()).width('100%').margin({ top: 8 })
              TextInput({ text: this.domain, placeholder: 'relay.example.com' }).type(InputType.URL).maxLength(270).enabled(!this.busy).id('relay-domain')
                .onChange((value: string) => { this.domain = value; this.status = ''; }).accessibilityText('中转域名')
              Text('访问令牌').fontSize(14).fontColor(this.ink()).width('100%').margin({ top: 8 })
              TextInput({ text: this.token, placeholder: '服务提供者给你的令牌' }).type(InputType.Password).maxLength(256).enabled(!this.busy).id('relay-token')
                .onChange((value: string) => { this.token = value; this.status = ''; }).accessibilityText('访问令牌')
              Text('令牌请求头').fontSize(14).fontColor(this.ink()).width('100%').margin({ top: 8 })
              TextInput({ text: this.headerName, placeholder: 'Authorization' }).maxLength(64).enabled(!this.busy).id('relay-header')
                .onChange((value: string) => { this.headerName = value; this.status = ''; }).accessibilityText('令牌请求头')
              Text('Authorization 自动添加 Bearer 前缀；其他字段直接发送令牌。请求头须与中转服务一致。').fontSize(12).fontColor('#718398').width('100%').lineHeight(19)
            }.width('100%').padding(16).backgroundColor(this.surface()).borderRadius(14)
            Button('测试连接').buttonStyle(ButtonStyleMode.NORMAL).width('100%').height(46).enabled(!this.busy).onClick(() => { this.operate('test'); })
            Button('保存配置').width('100%').height(46).enabled(!this.busy).onClick(() => { this.operate('save'); })
            if (this.registry.profiles.some((profile: RelayProfile) => profile.id === this.profileId)) {
              Button('删除配置').width('100%').height(40).fontColor('#D56464').backgroundColor(Color.Transparent).enabled(!this.busy).onClick(() => this.remove())
            }
          }
          if (!this.helpVisible && this.busy) { LoadingProgress().width(28).height(28).color('#268BDE') }
          if (!this.helpVisible && this.status) { Text(this.status).fontSize(13).fontColor(this.error ? '#D56464' : '#268BDE').lineHeight(21).width('100%') }
        }.width('100%').constraintSize({ maxWidth: 520 }).padding({ left: 20, right: 20, top: 72, bottom: 32 })
      }.width('100%').height('100%').align(Alignment.Top)
      }
    }.width('100%').height('100%').mode(NavigationMode.Stack).titleMode(HdsNavigationTitleMode.MINI)
      .hideBackButton(false).titleBar({ content: {
        title: { mainTitle: this.helpVisible ? '配置说明' : this.editing ? '代理配置' : '网络和代理管理' },
        backIcon: { icon: new SymbolGlyphModifier($r('sys.symbol.chevron_backward')).fontColor([$r('sys.color.icon_primary')]), label: '返回',
          isEnabled: !this.busy, action: () => this.back() },
        menu: { value: this.helpVisible ? [] : [{ content: {
          icon: new SymbolGlyphModifier($r('sys.symbol.questionmark_circle')).fontColor([$r('sys.color.icon_primary')]), label: '配置说明',
          isEnabled: !this.busy, action: () => { this.helpVisible = true; }
        } }] }
      } }).backgroundColor(this.dark ? '#101A25' : '#F4F7FB')
  }
}
