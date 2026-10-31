import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { RelayConfiguration, RelayRegistry, relayMigrate, relayRegistry, relaySelected } from '../model/RelayModels';

/** Global transport preference, isolated from Telegram credentials and databases. */
export class RelayPreferences {
  private static alias(): Uint8Array { return new util.TextEncoder().encodeInto('harlgram.network.relay.v1'); }
  static async load(): Promise<RelayConfiguration> { return relaySelected(await RelayPreferences.loadRegistry()); }
  static async loadRegistry(): Promise<RelayRegistry> {
    const query: asset.AssetMap = new Map(); query.set(asset.Tag.ALIAS, RelayPreferences.alias()); query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const records = await asset.query(query);
      if (!records.length) return { version: 2, activeId: '', profiles: [] };
      const bytes = records[0].get(asset.Tag.SECRET) as Uint8Array;
      const text = new util.TextDecoder().decodeToString(bytes);
      const value = JSON.parse(text) as RelayRegistry;
      // Read old single-route records without replacing credentials until a successful write.
      return value.version === undefined ? relayMigrate(JSON.parse(text) as RelayConfiguration) : relayRegistry(value);
    } catch (error) {
      if ((error as BusinessError).code === 24000002) return { version: 2, activeId: '', profiles: [] };
      throw new Error('无法读取网络配置，请检查后重试');
    }
  }
  static async save(value: RelayConfiguration): Promise<void> {
    await RelayPreferences.saveRegistry(relayMigrate(value));
  }
  static async saveRegistry(value: RelayRegistry): Promise<void> {
    const normalized = relayRegistry(value);
    const attributes: asset.AssetMap = new Map(); attributes.set(asset.Tag.ALIAS, RelayPreferences.alias());
    attributes.set(asset.Tag.SECRET, new util.TextEncoder().encodeInto(JSON.stringify(normalized)));
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    attributes.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
    await asset.add(attributes);
  }
}
