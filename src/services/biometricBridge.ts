import { discoverBridgeWebsocketUrl } from '@/services/bridgeDiscovery';

export type BiometricBridgeStatus = {
  configured: boolean;
  provider: string;
  deviceId: string;
  model?: string;
  simulation?: boolean;
  storesRawBiometrics?: boolean;
};

export type BiometricEnrollmentResult = {
  ok: boolean;
  employeeRef: string;
  fingerPosition: string;
  providerReference: string;
  templateHash: string;
  quality?: number;
  simulated?: boolean;
};

export type BiometricIdentificationResult = BiometricEnrollmentResult & {
  livenessPassed?: boolean;
};

const browserSimulationAllowed = () => {
  const hostname = window.location.hostname.toLowerCase();
  return hostname === 'localhost' || hostname.includes('vercel.app') || hostname.includes('homolog');
};

const simulatorKey = 'popsystem-biometric-homologation-enrollments';

const readSimulatorEnrollments = (): BiometricEnrollmentResult[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(simulatorKey) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeSimulatorEnrollments = (rows: BiometricEnrollmentResult[]) => {
  window.localStorage.setItem(simulatorKey, JSON.stringify(rows));
};

const sha256 = async (value: string) => {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const closeWebSocket = (ws: WebSocket) => {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
};

const requestBridge = async <T>(action: string, payload: Record<string, unknown> = {}, timeoutMs = 35000): Promise<T> => {
  const websocketUrl = await discoverBridgeWebsocketUrl({ timeoutMs: 900 });
  if (!websocketUrl) throw new Error('pop_connect_not_found');

  return await new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(websocketUrl);
    const timer = window.setTimeout(() => {
      closeWebSocket(ws);
      reject(new Error('biometric_reader_timeout'));
    }, timeoutMs);

    const finish = (callback: () => void) => {
      window.clearTimeout(timer);
      closeWebSocket(ws);
      callback();
    };

    ws.onerror = () => finish(() => reject(new Error('pop_connect_connection_failed')));
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.event === 'connected') {
          ws.send(JSON.stringify({ action, payload }));
          return;
        }
        if (data?.ok === false) {
          finish(() => reject(new Error(String(data.error || 'biometric_operation_failed'))));
          return;
        }
        finish(() => resolve(data as T));
      } catch {
        finish(() => reject(new Error('invalid_pop_connect_response')));
      }
    };
  });
};

export const getBiometricBridgeStatus = async (): Promise<BiometricBridgeStatus> => {
  try {
    const response = await requestBridge<{ biometric?: BiometricBridgeStatus }>('get_status', {}, 5000);
    if (response.biometric) return response.biometric;
  } catch (error) {
    void error;
  }
  if (browserSimulationAllowed()) {
    return {
      configured: true,
      provider: 'simulator_browser',
      deviceId: 'HOMOLOGACAO-BROWSER-01',
      model: 'Simulador seguro de homologação',
      simulation: true,
      storesRawBiometrics: false,
    };
  }
  return { configured: false, provider: 'not_configured', deviceId: '' };
};

export const enrollBiometric = async (employeeRef: string, fingerPosition: string): Promise<BiometricEnrollmentResult> => {
  try {
    return await requestBridge<BiometricEnrollmentResult>('enroll_biometric', { employeeRef, fingerPosition });
  } catch (error) {
    if (!browserSimulationAllowed()) throw error;
    const providerReference = crypto.randomUUID();
    const result: BiometricEnrollmentResult = {
      ok: true,
      employeeRef,
      fingerPosition,
      providerReference,
      templateHash: await sha256(`${providerReference}|${employeeRef}|${fingerPosition}`),
      quality: 0.98,
      simulated: true,
    };
    const previous = readSimulatorEnrollments().filter((row) => !(row.employeeRef === employeeRef && row.fingerPosition === fingerPosition));
    writeSimulatorEnrollments([...previous, result]);
    return result;
  }
};

export const identifyBiometric = async (): Promise<BiometricIdentificationResult> => {
  try {
    return await requestBridge<BiometricIdentificationResult>('identify_biometric');
  } catch (error) {
    if (!browserSimulationAllowed()) throw error;
    const match = readSimulatorEnrollments()[0];
    if (!match) throw new Error('biometric_not_recognized');
    return { ...match, livenessPassed: true, simulated: true };
  }
};

export const removeBiometric = async (providerReference: string) => {
  try {
    return await requestBridge<{ ok: boolean }>('remove_biometric', { providerReference });
  } catch (error) {
    if (!browserSimulationAllowed()) throw error;
    writeSimulatorEnrollments(readSimulatorEnrollments().filter((row) => row.providerReference !== providerReference));
    return { ok: true };
  }
};
