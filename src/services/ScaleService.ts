import { SCALE_CONFIGS, WebSerialScale, type ScaleReading } from './webSerialScale';

export interface ScaleDevice {
  id: string;
  name: string;
  type: 'serial';
  connected: boolean;
  address?: string;
}

const PROFILE_KEY = 'popsystem.pwa.scale.profile';

export class ScaleService {
  private profile = localStorage.getItem(PROFILE_KEY) || 'generic';
  private scale = new WebSerialScale(SCALE_CONFIGS[this.profile] || SCALE_CONFIGS.generic);

  isSupported() { return WebSerialScale.isSupported(); }
  isConnected() { return this.scale.connected; }
  getLatestReading() { return this.scale.latestReading; }
  subscribe(callback: (reading: ScaleReading) => void) { return this.scale.subscribe(callback); }

  async scanForScales(): Promise<ScaleDevice[]> {
    if (!this.isSupported()) return [];
    await this.scale.reconnectAuthorized();
    return [{
      id: 'pwa_serial_scale',
      name: this.scale.connected ? 'Balança serial autorizada' : 'Balança serial (USB/COM)',
      type: 'serial',
      connected: this.scale.connected,
      address: this.profile,
    }];
  }

  async connectToScale(_device?: ScaleDevice) { return this.scale.connect({ request: true }); }
  async disconnectScale() { await this.scale.disconnect(); }

  async getReading(timeoutMs = 1800): Promise<ScaleReading> {
    if (!this.scale.connected) throw new Error('Nenhuma balança conectada');
    const startedAt = Date.now();
    return new Promise<ScaleReading>(async (resolve, reject) => {
      let unsubscribe = () => {};
      const timeout = window.setTimeout(() => { unsubscribe(); reject(new Error('A balança não enviou peso')); }, timeoutMs);
      unsubscribe = this.scale.subscribe(reading => {
        if (reading.stable && (reading.readAt || 0) >= startedAt) {
          window.clearTimeout(timeout);
          unsubscribe();
          resolve(reading);
        }
      });
      try { await this.scale.requestReading(); } catch {}
    });
  }

  async getWeight() { return (await this.getReading()).weight; }
}

export const pwaScaleService = new ScaleService();
