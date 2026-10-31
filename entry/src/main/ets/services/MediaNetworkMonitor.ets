import { connection } from '@kit.NetworkKit';
import { radio } from '@kit.TelephonyKit';
import { MediaNetwork } from '../model/StorageModels';

/** Network identity stays local; no SSID, operator or address is persisted. */
export class MediaNetworkMonitor {
  private subscription: connection.NetConnection | undefined = undefined;
  private revision: number = 0;
  private onChange: (network: MediaNetwork) => void;
  constructor(onChange: (network: MediaNetwork) => void) { this.onChange = onChange; }
  start(): void {
    if (this.subscription) { this.refresh(); return; }
    try {
      const subscriber = connection.createNetConnection(); this.subscription = subscriber;
      subscriber.on('netAvailable', () => this.refresh());
      subscriber.on('netCapabilitiesChange', () => this.refresh());
      subscriber.on('netLost', () => this.refresh());
      subscriber.on('netUnavailable', () => this.refresh());
      subscriber.register(() => this.refresh());
    } catch (_) { this.refresh(); }
  }
  refresh(): void { this.read(++this.revision).catch(() => { this.onChange('unknown'); }); }
  private async read(revision: number): Promise<void> {
    let network: MediaNetwork = 'unknown';
    try {
      const handle = await connection.getDefaultNet();
      if (handle.netId === 0) { network = 'none'; }
      else {
        const caps = await connection.getNetCapabilities(handle);
        if (caps.bearerTypes.includes(connection.NetBearType.BEARER_WIFI) || caps.networkCap?.includes(connection.NetCap.NET_CAPABILITY_NOT_METERED)) { network = 'wifi'; }
        else if (caps.bearerTypes.includes(connection.NetBearType.BEARER_CELLULAR) || caps.bearerTypes.includes(connection.NetBearType.BEARER_VPN)) {
          // Unknown roaming state is conservative: use the roaming profile, disabled by default.
          try { network = (await radio.getNetworkState()).isRoaming ? 'roaming' : 'mobile'; } catch (_) { network = 'roaming'; }
        }
      }
    } catch (_) { network = 'unknown'; }
    if (revision === this.revision) { this.onChange(network); }
  }
  stop(): void {
    this.revision++; try { this.subscription?.unregister(() => {}); } catch (_) {}
    this.subscription = undefined;
  }
}
